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
const hasGreatLongNoseScript = fs.existsSync(path.join(upstreamRoot, "script", "official", "c2356994.lua"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasGreatLongNoseScript)("Lua real script Great Long Nose battle skip", () => {
  it("restores its battle-damage trigger into an opponent Battle Phase skip", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const noseCode = "2356994";
    const defenderCode = "2356995";
    const script = workspace.readScript(`c${noseCode}.lua`);
    expect(script).toContain("Spirit.AddProcedure(c,EVENT_SUMMON_SUCCESS,EVENT_FLIP)");
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
    expect(script).toContain("e2:SetCode(EVENT_BATTLE_DAMAGE)");
    expect(script).toContain("e1:SetCode(EFFECT_SKIP_BP)");
    expect(script).toContain("e1:SetTargetRange(0,1)");
    expect(script).toContain("e1:SetReset(RESET_PHASE|PHASE_END|RESET_OPPO_TURN,1)");
    expect(script).toContain("Duel.RegisterEffect(e1,tp)");
    const cards: DuelCardData[] = [
      { code: noseCode, name: "Great Long Nose", kind: "monster", typeFlags: typeMonster | typeEffect, level: 5, attack: 1900, defense: 1700 },
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
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSetup.restoreComplete, restoredSetup.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSetup.missingRegistryKeys).toEqual([]);
    expect(restoredSetup.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSetup, 0);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === nose!.uid && action.targetUid === defender!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passBattleUntilTrigger(restoredSetup);
    expect(restoredSetup.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: nose!.uid,
        eventPlayer: 1,
        eventValue: 900,
        eventReason: duelReason.battle,
        eventReasonCardUid: nose!.uid,
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
    expect(restoredSetup.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-7-1143",
          "eventCardUid": "p0-deck-2356994-0",
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
          "eventReasonCardUid": "p0-deck-2356994-0",
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "eventValue": 900,
          "id": "trigger-5-1",
          "player": 0,
          "sourceUid": "p0-deck-2356994-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === nose!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.effects.find((effect) => effect.sourceUid === nose!.uid && effect.event === "continuous" && effect.code === 183)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 183,
        "controller": 0,
        "cost": [Function],
        "description": 37711905,
        "event": "continuous",
        "id": "lua-8-183",
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
        "promptOperation": [Function],
        "property": 67110912,
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
        "registryKey": "lua:2356994:lua-8-183",
        "reset": {
          "count": 1,
          "flags": 1610613248,
        },
        "sourceUid": "p0-deck-2356994-0",
        "target": [Function],
        "targetRange": [
          0,
          1,
        ],
      }
    `);

    const restoredPhaseLock = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expect(restoredPhaseLock.restoreComplete, restoredPhaseLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPhaseLock.missingRegistryKeys).toEqual([]);
    expect(restoredPhaseLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredPhaseLock, 0);
    expect(restoredPhaseLock.session.state.effects.find((effect) => effect.sourceUid === nose!.uid && effect.event === "continuous" && effect.code === 183)).toMatchInlineSnapshot(`
      {
        "code": 183,
        "controller": 0,
        "description": 37711905,
        "event": "continuous",
        "id": "lua-8-183",
        "luaTypeFlags": 2,
        "oncePerTurn": false,
        "operation": [Function],
        "ownerPlayer": 0,
        "property": 67110912,
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
        "registryKey": "lua:2356994:lua-8-183",
        "reset": {
          "count": 1,
          "flags": 1610613248,
        },
        "sourceUid": "p0-deck-2356994-0",
        "targetRange": [
          0,
          1,
        ],
      }
    `);
    passBattleResponses(restoredPhaseLock);
    moveToMain2AndEndTurn(restoredPhaseLock.session, 0);

    const restoredOpponentMain = restoreDuelWithLuaScripts(serializeDuel(restoredPhaseLock.session), workspace, reader);
    expect(restoredOpponentMain.restoreComplete, restoredOpponentMain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpponentMain.missingRegistryKeys).toEqual([]);
    expect(restoredOpponentMain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredOpponentMain, 1);
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
