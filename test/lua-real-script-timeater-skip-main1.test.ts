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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Timeater Main Phase 1 skip", () => {
  it("restores its official battle-destroying trigger into an opponent Main Phase 1 skip", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const timeaterCode = "44913552";
    const defenderCode = "44913553";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === timeaterCode),
      { code: defenderCode, name: "Timeater Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 0, defense: 0 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 449, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [timeaterCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const timeater = requireCard(session, timeaterCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, timeater.uid, "monsterZone", 0);
    timeater.position = "faceUpAttack";
    timeater.faceUp = true;
    moveDuelCard(session.state, defender.uid, "monsterZone", 1);
    defender.position = "faceUpAttack";
    defender.faceUp = true;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(timeaterCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === timeater.uid && action.targetUid === defender.uid);
    expect(attack, JSON.stringify(getDuelLegalActions(session, 0), null, 2)).toBeDefined();
    applyActionAndAssert(session, attack);
    passBattleUntilTrigger(session);
    expect(session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-1-1139",
          "eventCardUid": "p0-deck-44913552-0",
          "eventCode": 1140,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "battleDestroyed",
          "eventPlayer": 1,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 33,
          "eventReasonCardUid": "p0-deck-44913552-0",
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "trigger-6-1",
          "player": 0,
          "sourceUid": "p0-deck-44913552-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0)).toEqual(getGroupedDuelLegalActions(restoredTrigger.session, 0));
    expect(getLuaRestoreLegalActions(restoredTrigger, 0)).toEqual(getDuelLegalActions(restoredTrigger.session, 0));
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === timeater.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restoredTrigger, trigger!);
    expect(result.ok, result.error).toBe(true);
    expect(restoredTrigger.session.state.effects.find((effect) => effect.sourceUid === timeater.uid && effect.event === "continuous" && effect.code === 182)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 182,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-2-182",
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
        "promptOperation": [Function],
        "property": 2048,
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:44913552:lua-2-182",
        "reset": {
          "flags": 1610612740,
        },
        "sourceUid": "p0-deck-44913552-0",
        "target": [Function],
        "targetRange": [
          0,
          1,
        ],
      }
    `);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);
    passBattleUntilOpen(restoredLock.session);
    moveToMain2AndEndTurn(restoredLock.session, 0);
    expect(restoredLock.session.state).toMatchObject({ turnPlayer: 1, phase: "main1", waitingFor: 1 });
    const restoredOpponentTurn = restoreDuelWithLuaScripts(serializeDuel(restoredLock.session), workspace, reader);
    expect(restoredOpponentTurn.restoreComplete, restoredOpponentTurn.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpponentTurn.missingRegistryKeys).toEqual([]);
    expect(restoredOpponentTurn.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredOpponentTurn, 1)).toEqual(getGroupedDuelLegalActions(restoredOpponentTurn.session, 1));
    expect(getLuaRestoreLegalActions(restoredOpponentTurn, 1)).toEqual(getDuelLegalActions(restoredOpponentTurn.session, 1));
    const opponentActions = getLuaRestoreLegalActions(restoredOpponentTurn, 1);
    expect(opponentActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "changePhase", phase: "battle" })]));
    expect(opponentActions).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: "normalSummon" })]));
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function passBattleUntilTrigger(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    passBattleStep(session);
  }
}

function passBattleUntilOpen(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    passBattleStep(session);
  }
}

function passBattleStep(session: DuelSession): void {
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  applyActionAndAssert(session, getDuelLegalActions(session, player).find((action) => action.type === passType));
}

function moveToMain2AndEndTurn(session: DuelSession, player: 0 | 1): void {
  const main2 = getDuelLegalActions(session, player).find((action) => action.type === "changePhase" && action.phase === "main2");
  expect(main2, JSON.stringify(getDuelLegalActions(session, player), null, 2)).toBeDefined();
  applyActionAndAssert(session, main2);
  applyActionAndAssert(session, getDuelLegalActions(session, player).find((action) => action.type === "endTurn"));
}

function applyActionAndAssert(session: DuelSession, action: DuelAction | undefined): void {
  expect(action, JSON.stringify(getDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer), null, 2)).toBeDefined();
  const result = applyResponse(session, action!);
  expect(result.ok, result.error).toBe(true);
}
