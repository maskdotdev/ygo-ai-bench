import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const effectDestroyReason = duelReason.effect | duelReason.destroy;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Scrap Worm Battle Phase destroy", () => {
  it("restores its attack flag and mandatory Battle Phase trigger destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const scrapWormCode = "32761286";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === scrapWormCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 327, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [scrapWormCode] }, 1: { main: [] } });
    startDuel(session);

    const scrapWorm = session.state.cards.find((card) => card.code === scrapWormCode);
    expect(scrapWorm).toBeDefined();
    moveDuelCard(session.state, scrapWorm!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(scrapWormCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === scrapWorm!.uid && ["attackDeclared", "phaseBattle"].includes(effect.triggerEvent ?? ""))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 1130,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-1130",
          "luaTypeFlags": 2049,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 1024,
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
          "registryKey": "lua:32761286:lua-1-1130",
          "sourceUid": "p0-deck-32761286-0",
          "target": [Function],
          "triggerCode": 1130,
          "triggerEvent": "attackDeclared",
        },
        {
          "canActivate": [Function],
          "category": 1,
          "code": 4224,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "description": 524180576,
          "event": "trigger",
          "id": "lua-2-4224",
          "luaTypeFlags": 514,
          "oncePerTurn": true,
          "operation": [Function],
          "optional": false,
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:32761286:lua-2-4224",
          "sourceUid": "p0-deck-32761286-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 4224,
          "triggerEvent": "phaseBattle",
          "triggerTiming": "when",
        },
      ]
    `);

    const directAttack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === scrapWorm!.uid && action.targetUid === undefined);
    expect(directAttack).toBeDefined();
    applyAndAssert(session, directAttack!);
    passBattleResponses(session);

    expect(session.state.players[1].lifePoints).toBe(7500);
    expect(session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerId: scrapWorm!.uid, code: Number(scrapWormCode) })]));
    expect(session.state.cards.find((card) => card.uid === scrapWorm!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredBattle.restoreComplete, restoredBattle.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattle.missingRegistryKeys).toEqual([]);
    expect(restoredBattle.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredBattle, 0);
    expect(restoredBattle.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerId: scrapWorm!.uid, code: Number(scrapWormCode) })]));
    const main2 = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2).toBeDefined();
    const phaseChanged = applyLuaRestoreResponse(restoredBattle, main2!);
    expect(phaseChanged.ok, phaseChanged.error).toBe(true);
    expect(restoredBattle.session.state.phase).toBe("main2");
    expect(restoredBattle.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-2-4224",
          "eventCode": 4224,
          "eventName": "phaseBattle",
          "eventTriggerTiming": "when",
          "id": "trigger-6-1",
          "player": 0,
          "sourceUid": "p0-deck-32761286-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0)).toEqual(getGroupedDuelLegalActions(restoredTrigger.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredTrigger, 0));
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === scrapWorm!.uid);
    expect(trigger).toBeDefined();
    const destroyed = applyLuaRestoreResponse(restoredTrigger, trigger!);
    expect(destroyed.ok, destroyed.error).toBe(true);

    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === scrapWorm!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: effectDestroyReason,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "attackDeclared")).toEqual([
      {
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: scrapWorm!.uid,
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
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "phaseBattle")).toEqual([
      {
        eventName: "phaseBattle",
        eventCode: 0x1080,
      },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === scrapWorm!.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: scrapWorm!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: effectDestroyReason,
        eventReasonPlayer: 0,
        eventReasonCardUid: scrapWorm!.uid,
        eventReasonEffectId: 2,
      },
    ]);
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
