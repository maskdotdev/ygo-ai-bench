import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Great Long Nose battle skip", () => {
  it("restores its battle-damage trigger into an opponent Battle Phase skip", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const noseCode = "2356994";
    const defenderCode = "2356995";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === noseCode),
      { code: defenderCode, name: "Great Long Nose Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 235, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [noseCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const nose = session.state.cards.find((card) => card.code === noseCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    expect(nose).toBeDefined();
    expect(defender).toBeDefined();
    moveDuelCard(session.state, nose!.uid, "monsterZone", 0);
    nose!.position = "faceUpAttack";
    nose!.faceUp = true;
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1);
    defender!.position = "faceUpAttack";
    defender!.faceUp = true;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(noseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSetup.restoreComplete, restoredSetup.incompleteReasons.join("; ")).toBe(true);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === nose!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passBattleUntilTrigger(restoredSetup);
    expect(restoredSetup.session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: nose!.uid,
          eventName: "battleDamageDealt",
          eventCode: 1143,
          eventPlayer: 1,
        }),
      ]),
    );

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0)).toEqual(getGroupedDuelLegalActions(restoredTrigger.session, 0));
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === nose!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: nose!.uid, event: "continuous", code: 183, controller: 0, targetRange: [0, 1] })]),
    );

    const restoredPhaseLock = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expect(restoredPhaseLock.restoreComplete, restoredPhaseLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPhaseLock.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: nose!.uid, event: "continuous", code: 183, controller: 0, targetRange: [0, 1] })]),
    );
    passBattleResponses(restoredPhaseLock);
    moveToMain2AndEndTurn(restoredPhaseLock.session, 0);

    const restoredOpponentMain = restoreDuelWithLuaScripts(serializeDuel(restoredPhaseLock.session), workspace, reader);
    expect(restoredOpponentMain.restoreComplete, restoredOpponentMain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpponentMain.session.state).toMatchObject({ turnPlayer: 1, phase: "main1", waitingFor: 1 });
    const opponentActions = getLuaRestoreLegalActions(restoredOpponentMain, 1);
    expect(opponentActions).toEqual(getDuelLegalActions(restoredOpponentMain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredOpponentMain, 1)).toEqual(getGroupedDuelLegalActions(restoredOpponentMain.session, 1));
    expect(opponentActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "main2" })]));
    expect(opponentActions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));
  });
});

function passBattleUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function moveToMain2AndEndTurn(session: DuelSession, player: 0 | 1): void {
  const main2 = getDuelLegalActions(session, player).find((action) => action.type === "changePhase" && action.phase === "main2");
  expect(main2, JSON.stringify(getDuelLegalActions(session, player), null, 2)).toBeDefined();
  let result = applyResponse(session, main2!);
  expect(result.ok, result.error).toBe(true);
  const endTurn = getDuelLegalActions(session, player).find((action) => action.type === "endTurn");
  expect(endTurn, JSON.stringify(getDuelLegalActions(session, player), null, 2)).toBeDefined();
  result = applyResponse(session, endTurn!);
  expect(result.ok, result.error).toBe(true);
}
