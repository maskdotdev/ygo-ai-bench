import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Necro Gardna delayed attack negate", () => {
  it("restores its graveyard self-banish cost and one-shot attack-announcement negate", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const necroGardnaCode = "4906301";
    const attackerCode = "490631";
    const secondAttackerCode = "490633";
    const targetCode = "490632";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === necroGardnaCode),
      { code: attackerCode, name: "Necro Gardna Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: secondAttackerCode, name: "Necro Gardna Second Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1200 },
      { code: targetCode, name: "Necro Gardna Attack Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4906, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [necroGardnaCode, targetCode] }, 1: { main: [attackerCode, secondAttackerCode] } });
    startDuel(session);

    const necroGardna = session.state.cards.find((card) => card.code === necroGardnaCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const secondAttacker = session.state.cards.find((card) => card.code === secondAttackerCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(necroGardna).toBeDefined();
    expect(attacker).toBeDefined();
    expect(secondAttacker).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, necroGardna!.uid, "graveyard", 0);
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, secondAttacker!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.turn = 2;
    session.state.turnPlayer = 1;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(necroGardnaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredActivation.restoreComplete, restoredActivation.incompleteReasons.join("; ")).toBe(true);
    expect(restoredActivation.missingRegistryKeys).toEqual([]);
    expect(restoredActivation.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredActivation, 0);
    const activate = getLuaRestoreLegalActions(restoredActivation, 0).find(
      (action) => action.type === "activateEffect" && action.uid === necroGardna!.uid,
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activate!);
    resolveRestoredChain(restoredActivation);

    expect(restoredActivation.session.state.cards.find((card) => card.uid === necroGardna!.uid)).toMatchObject({
      location: "banished",
      previousLocation: "graveyard",
    });
    expect(restoredActivation.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === necroGardna!.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: necroGardna!.uid,
        eventReason: duelReason.cost,
        eventReasonCardUid: necroGardna!.uid,
        eventReasonEffectId: 1,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "banished",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restoredActivation.session.state.effects.filter((effect) => effect.sourceUid === necroGardna!.uid && effect.code === 1130)).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 1130,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "event": "continuous",
          "id": "lua-2-1130",
          "luaTypeFlags": 2050,
          "oncePerTurn": true,
          "operation": [Function],
          "ownerPlayer": 0,
          "promptOperation": [Function],
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
          "registryKey": "lua:4906301:lua-2-1130",
          "reset": {
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-4906301-0",
          "target": [Function],
          "triggerCode": 1130,
          "triggerEvent": "attackDeclared",
          "triggerTiming": "when",
        },
      ]
    `);

    const restoredLock = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), workspace, reader);
    expect(restoredLock.restoreComplete, restoredLock.incompleteReasons.join("; ")).toBe(true);
    expect(restoredLock.missingRegistryKeys).toEqual([]);
    expect(restoredLock.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredLock, 0);
    restoredLock.session.state.phase = "battle";
    restoredLock.session.state.waitingFor = 1;
    expectRestoredLegalActions(restoredLock, 1);

    const attack = getLuaRestoreLegalActions(restoredLock, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredLock, 1), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredLock, attack!);

    expect(restoredLock.session.state.pendingBattle).toBeUndefined();
    expect(restoredLock.session.state.currentAttack).toBeUndefined();
    expect(restoredLock.session.state.attackCanceledUids).toEqual([attacker!.uid]);
    expect(restoredLock.session.state.usedCountKeys).toContain(`turn-2:0:${necroGardna!.uid}:lua-2-1130`);
    expect(restoredLock.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredLock.session.state.eventHistory.filter((event) => event.eventName === "attackDeclared" && event.eventCardUid === attacker!.uid)).toEqual([
      {
        eventName: "attackDeclared",
        eventCode: 1130,
        eventCardUid: attacker!.uid,
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
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
    expect(restoredLock.session.state.eventHistory.filter((event) => event.eventName === "attackDisabled" && event.eventCardUid === attacker!.uid)).toEqual([
      {
        eventName: "attackDisabled",
        eventCode: 1142,
        eventCardUid: attacker!.uid,
        eventPlayer: 1,
        eventReason: duelReason.effect,
        eventReasonCardUid: necroGardna!.uid,
        eventReasonEffectId: 2,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
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

    expect(restoredLock.session.state.eventHistory.filter((event) => event.eventName === "attackDisabled")).toHaveLength(1);
  });
});

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
