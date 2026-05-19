import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const goblinCode = "78658564";
const hasGoblinScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${goblinCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasGoblinScript)("Lua real script Goblin Attack Force position lock", () => {
  it("restores its Battle Phase self-defense change and copied cannot-change-position lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const targetCode = "7865";
    const script = workspace.readScript(`c${goblinCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_PHASE|PHASE_BATTLE)");
    expect(script).toContain("return e:GetHandler():GetAttackedCount()>0");
    expect(script).toContain("Duel.ChangePosition(c,POS_FACEUP_DEFENSE)");
    expect(script).toContain("e1:SetCode(EFFECT_CANNOT_CHANGE_POSITION)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_COPY_INHERIT)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END,3)");

    const cards: DuelCardData[] = [
      { code: goblinCode, name: "Goblin Attack Force", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2300, defense: 0 },
      { code: targetCode, name: "Goblin Force Fixture Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 786, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [goblinCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const goblin = session.state.cards.find((card) => card.code === goblinCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(goblin).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, goblin!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(goblinCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === goblin!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(session.state.cards.find((card) => card.uid === goblin!.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpAttack" });
    expect(session.state.players[1].lifePoints).toBe(6700);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.host.messages).toEqual(host.messages);
    expect(host.messages).not.toContain("unsupported");

    const restoredMain2 = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(restoredMain2).toBeDefined();
    const changed = applyLuaRestoreResponse(restored, restoredMain2!);
    expect(changed.ok, changed.error).toBe(true);
    expect(changed.legalActions).toEqual(getLuaRestoreLegalActions(restored, changed.state.waitingFor!));
    expect(changed.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, changed.state.waitingFor!));
    expect(changed.legalActionGroups.flatMap((group) => group.actions)).toEqual(changed.legalActions);

    expect(restored.session.state.phase).toBe("main2");
    expect(restored.session.state.cards.find((card) => card.uid === goblin!.uid)).toMatchObject({ location: "monsterZone", controller: 0, position: "faceUpDefense" });
    expect(restored.session.state.effects.some((effect) => effect.sourceUid === goblin!.uid && effect.code === 14)).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0).some((action) => action.type === "changePosition" && action.uid === goblin!.uid)).toBe(false);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "phaseBattle")).toEqual([
      {
        eventName: "phaseBattle",
        eventCode: 0x1080,
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" && event.eventCardUid === goblin!.uid)).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: goblin!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: goblin!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 0,
        },
      },
    ]);

    const probeHost = createLuaScriptHost(restored.session, workspace);
    const probe = probeHost.loadScript(
      `
      local goblin = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("goblin force lock " .. tostring(goblin:IsCanChangePosition(POS_FACEUP_ATTACK)) .. "/" .. Duel.ChangePosition(goblin, POS_FACEUP_ATTACK))
      `,
      "goblin-force-position-lock-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(probeHost.messages).toEqual(["goblin force lock false/0"]);
    expect(probeHost.messages).not.toContain("unsupported");
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
