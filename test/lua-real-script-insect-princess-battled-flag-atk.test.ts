import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Insect Princess battled flag ATK", () => {
  it("restores EVENT_BATTLED flag state into its battle-destroying ATK gain trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const insectPrincessCode = "37957847";
    const battleTargetCode = "3795";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === insectPrincessCode),
      { code: battleTargetCode, name: "Insect Princess Battle Target", kind: "monster", typeFlags: 0x1, level: 4, race: 0x800, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 379, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [insectPrincessCode] }, 1: { main: [battleTargetCode] } });
    startDuel(session);

    const insectPrincess = session.state.cards.find((card) => card.code === insectPrincessCode);
    const battleTarget = session.state.cards.find((card) => card.code === battleTargetCode);
    expect(insectPrincess).toBeDefined();
    expect(battleTarget).toBeDefined();
    moveDuelCard(session.state, insectPrincess!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, battleTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    const script = workspace.readScript(`c${insectPrincessCode}.lua`);
    expect(script).toContain("e2:SetCode(EVENT_BATTLED)");
    expect(script).toContain("RegisterFlagEffect(id,RESET_PHASE|PHASE_DAMAGE,0,1)");
    expect(script).toContain("e3:SetCode(EVENT_BATTLE_DESTROYING)");
    expect(script).toContain("e:GetHandler():GetBattleTarget()");
    expect(script).toContain("EFFECT_UPDATE_ATTACK");
    expect(host.loadCardScript(Number(insectPrincessCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === insectPrincess!.uid && action.targetUid === battleTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session);

    expect(session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-3-1139",
        eventCardUid: insectPrincess!.uid,
        eventCode: 1140,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventName: "battleDestroyed",
        eventPlayer: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventReason: 33,
        eventReasonCardUid: insectPrincess!.uid,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        id: "trigger-7-1",
        player: 0,
        sourceUid: insectPrincess!.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === insectPrincess!.uid);
    expect(trigger).toBeDefined();
    const triggered = applyLuaRestoreResponse(restored, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);
    expect(triggered.legalActions).toEqual(getLegalActions(restored.session, triggered.state.waitingFor!));
    expect(triggered.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggered.state.waitingFor!));
    expect(triggered.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggered.legalActions);

    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === insectPrincess!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === battleTarget!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    const probe = restored.host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${insectPrincessCode}), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("insect princess attack " .. c:GetAttack())
      Debug.Message("insect princess battle flag " .. c:GetFlagEffect(${insectPrincessCode}))
      `,
      "insect-princess-atk-flag-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("insect princess attack 2400");
    expect(restored.host.messages).toContain("insect princess battle flag 1");
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "afterDamageCalculation")).toEqual([
      {
        eventName: "afterDamageCalculation",
        eventCode: 1138,
        eventCardUid: insectPrincess!.uid,
        eventUids: [insectPrincess!.uid, battleTarget!.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function passUntilPendingTrigger(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
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
