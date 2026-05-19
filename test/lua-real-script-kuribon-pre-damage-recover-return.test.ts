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
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Kuribon pre-damage recovery", () => {
  it("restores its attacked-target pre-damage recovery, battle-damage prevention, and self return to hand", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kuribonCode = "47432275";
    const attackerCode = "47432276";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kuribonCode),
      { code: attackerCode, name: "Kuribon Fixture Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 474, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kuribonCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const kuribon = session.state.cards.find((card) => card.code === kuribonCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    expect(kuribon).toBeDefined();
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, kuribon!.uid, "monsterZone", 0);
    kuribon!.position = "faceUpAttack";
    kuribon!.faceUp = true;
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    const script = workspace.readScript(`c${kuribonCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("Duel.GetAttackTarget()==e:GetHandler() and Duel.GetBattleDamage(tp)>0");
    expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
    expect(script).toContain("Duel.SetTargetParam(val)");
    expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
    expect(script).toContain("Duel.Recover(p,d,REASON_EFFECT)");
    expect(script).toContain("Duel.SendtoHand(c,nil,REASON_EFFECT)");
    expect(host.loadCardScript(Number(kuribonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === kuribon!.uid,
    );
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilBattleWindow(session, "beforeDamageCalculation");

    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(session.state.pendingBattle).toMatchObject({
      attackerUid: attacker!.uid,
      targetUid: kuribon!.uid,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "beforeDamageCalculation")).toEqual([
      {
        eventName: "beforeDamageCalculation",
        eventCode: 1134,
        eventCardUid: attacker!.uid,
        eventUids: [attacker!.uid, kuribon!.uid],
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === kuribon!.uid)).toMatchObject({
      event: "quick",
      triggerEvent: "beforeDamageCalculation",
      range: ["monsterZone"],
    });

    const activation = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === kuribon!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restored, activation!);
    expect(activated.ok, activated.error).toBe(true);
    expect(activated.legalActions).toEqual(getLegalActions(restored.session, activated.state.waitingFor!));
    expect(activated.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, activated.state.waitingFor!));
    expect(activated.legalActionGroups.flatMap((group) => group.actions)).toEqual(activated.legalActions);
    expect(restored.session.state.cards.find((card) => card.uid === kuribon!.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: kuribon!.uid,
      reasonEffectId: 1,
    });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(9800);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "recoveredLifePoints")).toEqual([
      {
        eventName: "recoveredLifePoints",
        eventCode: 1112,
        eventPlayer: 1,
        eventValue: 1800,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kuribon!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToHand")).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: kuribon!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kuribon!.uid,
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
          faceUp: false,
          location: "hand",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);

    passRestoredBattleResponses(restored);
    expect(restored.session.state.pendingBattle).toBeUndefined();
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(9800);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt" && event.eventPlayer === 0)).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
  });
});

function passUntilBattleWindow(session: DuelSession, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
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
