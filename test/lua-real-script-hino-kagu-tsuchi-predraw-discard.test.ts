import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Hino-Kagu-Tsuchi predraw discard", () => {
  it("restores its battle-damage trigger into the opponent's next Draw Phase hand discard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const hinoCode = "75745607";
    const defenderCode = "75745608";
    const discardACode = "75745609";
    const discardBCode = "75745610";
    const drawCode = "75745611";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === hinoCode),
      { code: defenderCode, name: "Hino Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: discardACode, name: "Hino Discard A", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: discardBCode, name: "Hino Discard B", kind: "monster", typeFlags: typeMonster, level: 4 },
      { code: drawCode, name: "Hino Draw After Discard", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 757, startingHandSize: 0, drawPerTurn: 1, cardReader: reader });
    loadDecks(session, { 0: { main: [hinoCode] }, 1: { main: [defenderCode, discardACode, discardBCode, drawCode] } });
    startDuel(session);

    const hino = session.state.cards.find((card) => card.code === hinoCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const discardA = session.state.cards.find((card) => card.code === discardACode);
    const discardB = session.state.cards.find((card) => card.code === discardBCode);
    const draw = session.state.cards.find((card) => card.code === drawCode);
    expect(hino).toBeDefined();
    expect(defender).toBeDefined();
    expect(discardA).toBeDefined();
    expect(discardB).toBeDefined();
    expect(draw).toBeDefined();
    moveDuelCard(session.state, hino!.uid, "monsterZone", 0);
    hino!.position = "faceUpAttack";
    hino!.faceUp = true;
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1);
    defender!.position = "faceUpAttack";
    defender!.faceUp = true;
    moveDuelCard(session.state, discardA!.uid, "hand", 1);
    moveDuelCard(session.state, discardB!.uid, "hand", 1);
    draw!.sequence = 0;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hinoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSetup.restoreComplete, restoredSetup.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSetup.missingRegistryKeys).toEqual([]);
    expect(restoredSetup.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSetup, 0);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === hino!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passBattleUntilTrigger(restoredSetup);
    expect(restoredSetup.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-7-1143",
          "eventCardUid": "p0-deck-75745607-0",
          "eventCode": 1143,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "battleDamageDealt",
          "eventPlayer": 1,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 32,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "eventValue": 1800,
          "id": "trigger-5-1",
          "player": 0,
          "sourceUid": "p0-deck-75745607-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === hino!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    drainRestoredChain(restoredChain);
    expect(restoredChain.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: hino!.uid, event: "continuous", code: 1113, controller: 0 })]),
    );
    expect(restoredChain.session.state.cards.find((card) => card.uid === discardA!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === discardB!.uid)).toMatchObject({ location: "hand", controller: 1 });

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), workspace, reader);
    expect(restoredBattle.restoreComplete, restoredBattle.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattle.missingRegistryKeys).toEqual([]);
    expect(restoredBattle.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredBattle, restoredBattle.session.state.waitingFor ?? restoredBattle.session.state.turnPlayer);
    passBattleResponses(restoredBattle);
    moveToMain2AndEndTurn(restoredBattle.session, 0);

    expect(restoredBattle.session.state.turnPlayer).toBe(1);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === discardA!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === discardB!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBattle.session.state.cards.find((card) => card.uid === draw!.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredBattle.session.state.effects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: hino!.uid, event: "continuous", code: 1113, controller: 0 })]),
    );
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "preDraw" && event.eventPlayer === 1)).toEqual([
      {
        eventName: "preDraw",
        eventCode: 1113,
        eventPlayer: 1,
        eventValue: 1,
      },
    ]);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discardA!.uid,
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: hino!.uid,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 1,
        },
      },
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: discardB!.uid,
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: hino!.uid,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 2,
        },
      },
    ]);
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

function drainRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
