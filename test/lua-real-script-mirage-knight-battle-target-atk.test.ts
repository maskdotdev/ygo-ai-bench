import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { currentAttack } from "#duel/card-stats.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mirage Knight battle-target ATK", () => {
  it("restores GetBattleTarget damage-calculation ATK and End Phase self-banish after battle", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const mirageCode = "49217579";
    const targetCode = "49217580";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === mirageCode),
      { code: targetCode, name: "Mirage Knight Fixture Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1900, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 492, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [mirageCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const mirage = session.state.cards.find((card) => card.code === mirageCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(mirage).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, mirage!.uid, "monsterZone", 0);
    mirage!.position = "faceUpAttack";
    mirage!.faceUp = true;
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(mirageCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === mirage!.uid && action.targetUid === target!.uid,
    );
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilBattleWindow(session, "duringDamageCalculation");
    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(currentAttack(mirage!, session.state)).toBe(4700);

    const restoredDamageCalc = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredDamageCalc.restoreComplete, restoredDamageCalc.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDamageCalc.missingRegistryKeys).toEqual([]);
    expect(restoredDamageCalc.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredDamageCalc.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(currentAttack(restoredDamageCalc.session.state.cards.find((card) => card.uid === mirage!.uid)!, restoredDamageCalc.session.state)).toBe(4700);
    expectRestoredLegalActions(restoredDamageCalc, 0);

    passRestoredBattleResponses(restoredDamageCalc);
    expect(restoredDamageCalc.session.state.pendingBattle).toBeUndefined();
    expect(restoredDamageCalc.session.state.battleDamage).toEqual({ 0: 0, 1: 2800 });
    expect(restoredDamageCalc.session.state.players[1].lifePoints).toBe(5200);
    expect(restoredDamageCalc.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredDamageCalc.session.state.cards.find((card) => card.uid === mirage!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });

    moveToEndPhase(restoredDamageCalc.session);
    const restoredEndPhase = restoreDuelWithLuaScripts(serializeDuel(restoredDamageCalc.session), workspace, reader);
    expect(restoredEndPhase.restoreComplete, restoredEndPhase.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEndPhase.missingRegistryKeys).toEqual([]);
    expect(restoredEndPhase.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEndPhase, 0);
    expect(restoredEndPhase.session.state.phase).toBe("end");
    const trigger = getLuaRestoreLegalActions(restoredEndPhase, 0).find((action) => action.type === "activateTrigger" && action.uid === mirage!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredEndPhase, 0), null, 2)).toBeDefined();
    const activated = applyLuaRestoreResponse(restoredEndPhase, trigger!);
    expect(activated.ok, activated.error).toBe(true);
    resolveRestoredChain(restoredEndPhase);
    expect(restoredEndPhase.session.state.cards.find((card) => card.uid === mirage!.uid)).toMatchObject({ location: "banished", controller: 0 });
    expect(restoredEndPhase.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "battleDamageDealt", eventPlayer: 1, eventValue: 2800 }),
      ]),
    );
    expect(restoredEndPhase.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === mirage!.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: mirage!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: mirage!.uid,
        eventReasonEffectId: 3,
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
          location: "banished",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
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

function moveToEndPhase(session: DuelSession): void {
  const main2 = getLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
  expect(main2, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
  let result = applyResponse(session, main2!);
  expect(result.ok, result.error).toBe(true);
  const end = getLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "end");
  expect(end, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
  result = applyResponse(session, end!);
  expect(result.ok, result.error).toBe(true);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
