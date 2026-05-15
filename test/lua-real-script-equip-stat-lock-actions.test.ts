import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  destroyDuelCard,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Equip stat and lock actions", () => {
  it("restores Big Bang Shot equip stat, piercing, and leave-field banish cleanup", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const bigBangCode = "61127349";
    const targetCode = "601029";
    const battleTargetCode = "601030";
    const responderCode = "601031";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bigBangCode),
      { code: targetCode, name: "Big Bang Shot Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1600, defense: 1000 },
      { code: battleTargetCode, name: "Big Bang Shot Defense Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 900, defense: 1000 },
      { code: responderCode, name: "Big Bang Shot Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 308, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bigBangCode, targetCode] }, 1: { main: [battleTargetCode, responderCode] } });
    startDuel(session);

    const bigBang = session.state.cards.find((card) => card.code === bigBangCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const battleTarget = session.state.cards.find((card) => card.code === battleTargetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(bigBang).toBeDefined();
    expect(target).toBeDefined();
    expect(battleTarget).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, bigBang!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, battleTarget!.uid, "monsterZone", 1).position = "faceUpDefense";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(bigBangCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredEquipWindow);
    expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === bigBang!.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    expect(restoredEquipWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 262144,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-61127349-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-61127349-0",
        "targetUids": [
          "p0-deck-601029-1",
        ],
      }
    `);
    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("equip responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === bigBang!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      faceUp: true,
    });

    const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipState);
    expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
    expect(restoredEquipState.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === bigBang!.uid && [100, 203].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 100,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-3-100",
          "luaTypeFlags": 4,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:61127349:lua-3-100",
          "sourceUid": "p0-deck-61127349-0",
          "target": [Function],
          "value": 400,
        },
        {
          "canActivate": [Function],
          "code": 203,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-4-203",
          "luaTypeFlags": 4,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:61127349:lua-4-203",
          "sourceUid": "p0-deck-61127349-0",
          "target": [Function],
        },
      ]
    `);
    expectLuaEquipProbe(restoredEquipState, targetCode, bigBangCode, "equip probe 61127349/2000");

    restoredEquipState.session.state.turnPlayer = 0;
    restoredEquipState.session.state.phase = "battle";
    restoredEquipState.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, restoredBattle.session.state.waitingFor ?? restoredBattle.session.state.turnPlayer);
    const attack = getLuaRestoreLegalActions(restoredBattle, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === target!.uid && action.targetUid === battleTarget!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattle, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattle, attack!);
    passRestoredBattleResponsesUntilTrigger(restoredBattle);
    expect(restoredBattle.session.state.battleDamage[1]).toBe(1000);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: target!.uid,
        eventPlayer: 1,
        eventValue: 1000,
        eventReason: duelReason.battle,
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

    destroyDuelCard(restoredBattle.session.state, bigBang!.uid, 0, duelReason.effect | duelReason.destroy, 0);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === bigBang!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousEquippedToUid: target!.uid,
    });
    expect(restoredBattle.session.state.pendingTriggers).toEqual([]);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "banished",
      previousLocation: "monsterZone",
      faceUp: true,
    });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "leftField" && event.eventCardUid === bigBang!.uid)).toEqual([
      {
        eventName: "leftField",
        eventCode: 1015,
        eventCardUid: bigBang!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: bigBang!.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === target!.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: target!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: bigBang!.uid,
        eventReasonEffectId: 5,
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

    const restoredCleanup = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), source, reader);
    expectCleanRestore(restoredCleanup);
    expectRestoredLegalActions(restoredCleanup, restoredCleanup.session.state.waitingFor ?? restoredCleanup.session.state.turnPlayer);
    expect(restoredCleanup.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "banished", faceUp: true });
  });

  it("restores Megamorph LP-conditional set-attack equip callbacks", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const megamorphCode = "22046459";
    const targetCode = "601032";
    const responderCode = "601033";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === megamorphCode),
      { code: targetCode, name: "Megamorph Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Megamorph Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 309, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [megamorphCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const megamorph = session.state.cards.find((card) => card.code === megamorphCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(megamorph).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, megamorph!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(megamorphCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredEquipWindow);
    expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
    expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredEquipWindow.session, 0));
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === megamorph!.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    expect(restoredEquipWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 262144,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-22046459-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-22046459-0",
        "targetUids": [
          "p0-deck-601032-1",
        ],
      }
    `);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("equip responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === megamorph!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      faceUp: true,
    });

    const restoredEqualLp = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEqualLp);
    expectRestoredLegalActions(restoredEqualLp, restoredEqualLp.session.state.waitingFor ?? restoredEqualLp.session.state.turnPlayer);
    expect(restoredEqualLp.session.state.effects.find((effect) => effect.event === "continuous" && effect.sourceUid === megamorph!.uid && effect.code === 101)).toMatchInlineSnapshot(`
      {
        "battleDamageValue": [Function],
        "canActivate": [Function],
        "code": 101,
        "controller": 0,
        "cost": [Function],
        "event": "continuous",
        "id": "lua-3-101",
        "lifePointValue": [Function],
        "luaTypeFlags": 4,
        "oncePerTurn": false,
        "operation": [Function],
        "range": [
          "spellTrapZone",
        ],
        "registryKey": "lua:22046459:lua-3-101",
        "sourceUid": "p0-deck-22046459-0",
        "statValue": [Function],
        "target": [Function],
        "valueCardPredicate": [Function],
        "valuePredicate": [Function],
      }
    `);
    expectLuaEquipStatProbe(restoredEqualLp, targetCode, megamorphCode, "equip stat probe 22046459/1000/1000");

    restoredEqualLp.session.state.players[0].lifePoints = 6000;
    restoredEqualLp.session.state.players[1].lifePoints = 8000;
    const restoredLowerLp = restoreDuelWithLuaScripts(serializeDuel(restoredEqualLp.session), source, reader);
    expectCleanRestore(restoredLowerLp);
    expectRestoredLegalActions(restoredLowerLp, restoredLowerLp.session.state.waitingFor ?? restoredLowerLp.session.state.turnPlayer);
    expectLuaEquipStatProbe(restoredLowerLp, targetCode, megamorphCode, "equip stat probe 22046459/2000/1000");

    restoredLowerLp.session.state.players[0].lifePoints = 9000;
    restoredLowerLp.session.state.players[1].lifePoints = 8000;
    const restoredHigherLp = restoreDuelWithLuaScripts(serializeDuel(restoredLowerLp.session), source, reader);
    expectCleanRestore(restoredHigherLp);
    expectRestoredLegalActions(restoredHigherLp, restoredHigherLp.session.state.waitingFor ?? restoredHigherLp.session.state.turnPlayer);
    expectLuaEquipStatProbe(restoredHigherLp, targetCode, megamorphCode, "equip stat probe 22046459/500/1000");
  });

  it("restores Gravity Axe equip stat and opponent position-change lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gravityAxeCode = "32022366";
    const targetCode = "601034";
    const opponentMonsterCode = "601035";
    const responderCode = "601036";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gravityAxeCode),
      { code: targetCode, name: "Gravity Axe Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: opponentMonsterCode, name: "Gravity Axe Opponent Monster", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Gravity Axe Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 310, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gravityAxeCode, targetCode] }, 1: { main: [opponentMonsterCode, responderCode] } });
    startDuel(session);

    const gravityAxe = session.state.cards.find((card) => card.code === gravityAxeCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const opponentMonster = session.state.cards.find((card) => card.code === opponentMonsterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(gravityAxe).toBeDefined();
    expect(target).toBeDefined();
    expect(opponentMonster).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, gravityAxe!.uid, "hand", 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(gravityAxeCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredEquipWindow);
    expectRestoredLegalActions(restoredEquipWindow, restoredEquipWindow.session.state.waitingFor ?? restoredEquipWindow.session.state.turnPlayer);
    expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredEquipWindow.session, 0));
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === gravityAxe!.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    expect(restoredEquipWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 262144,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-32022366-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-32022366-0",
        "targetUids": [
          "p0-deck-601034-1",
        ],
      }
    `);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, restoredChain.session.state.waitingFor ?? restoredChain.session.state.turnPlayer);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.host.messages).not.toContain("equip responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === gravityAxe!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      faceUp: true,
    });

    const restoredEquipState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredEquipState);
    expectRestoredLegalActions(restoredEquipState, restoredEquipState.session.state.waitingFor ?? restoredEquipState.session.state.turnPlayer);
    expect(restoredEquipState.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === gravityAxe!.uid && [14, 100].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 100,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-3-100",
          "luaTypeFlags": 4,
          "oncePerTurn": false,
          "operation": [Function],
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:32022366:lua-3-100",
          "sourceUid": "p0-deck-32022366-0",
          "target": [Function],
          "value": 500,
        },
        {
          "canActivate": [Function],
          "code": 14,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-4-14",
          "luaTypeFlags": 2,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 256,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:32022366:lua-4-14",
          "sourceUid": "p0-deck-32022366-0",
          "target": [Function],
          "targetRange": [
            0,
            4,
          ],
        },
      ]
    `);
    expectLuaEquipProbe(restoredEquipState, targetCode, gravityAxeCode, "equip probe 32022366/1500");

    restoredEquipState.session.state.turnPlayer = 1;
    restoredEquipState.session.state.phase = "main1";
    restoredEquipState.session.state.waitingFor = 1;
    const restoredOpponentMain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipState.session), source, reader);
    expectCleanRestore(restoredOpponentMain);
    expectRestoredLegalActions(restoredOpponentMain, restoredOpponentMain.session.state.waitingFor ?? restoredOpponentMain.session.state.turnPlayer);
    expect(getLuaRestoreLegalActions(restoredOpponentMain, 1).some((action) => action.type === "changePosition" && action.uid === opponentMonster!.uid)).toBe(false);

    const lockProbe = restoredOpponentMain.host.loadScript(
      `
      local locked=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${opponentMonsterCode}),1,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("gravity axe position probe " .. tostring(locked:IsCanChangePosition(POS_FACEUP_DEFENSE)))
      `,
      "gravity-axe-position-lock-probe.lua",
    );
    expect(lockProbe.ok, lockProbe.error).toBe(true);
    expect(restoredOpponentMain.host.messages).toContain("gravity axe position probe false");
  });

  it("restores Guardian Grarl summon procedure gated by face-up Gravity Axe", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const guardianCode = "47150851";
    const gravityAxeCode = "32022366";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === guardianCode || card.code === gravityAxeCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 316, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [guardianCode, gravityAxeCode] }, 1: { main: [] } });
    startDuel(session);

    const guardian = session.state.cards.find((card) => card.code === guardianCode);
    const gravityAxe = session.state.cards.find((card) => card.code === gravityAxeCode);
    expect(guardian).toBeDefined();
    expect(gravityAxe).toBeDefined();
    moveDuelCard(session.state, guardian!.uid, "hand", 0);
    moveDuelCard(session.state, gravityAxe!.uid, "deck", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(guardianCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredLocked = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredLocked);
    expectRestoredLegalActions(restoredLocked, restoredLocked.session.state.waitingFor ?? restoredLocked.session.state.turnPlayer);
    expect(getLuaRestoreLegalActionGroups(restoredLocked, 0)).toEqual(getGroupedDuelLegalActions(restoredLocked.session, 0));
    expect(getLuaRestoreLegalActions(restoredLocked, 0)).toEqual(getDuelLegalActions(restoredLocked.session, 0));
    expect(getLuaRestoreLegalActions(restoredLocked, 0).some((action) => action.type === "normalSummon" && action.uid === guardian!.uid)).toBe(false);
    expect(getLuaRestoreLegalActions(restoredLocked, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === guardian!.uid)).toBe(false);

    moveDuelCard(restoredLocked.session.state, gravityAxe!.uid, "spellTrapZone", 0).faceUp = true;
    const restoredUnlocked = restoreDuelWithLuaScripts(serializeDuel(restoredLocked.session), workspace, reader);
    expectCleanRestore(restoredUnlocked);
    expectRestoredLegalActions(restoredUnlocked, restoredUnlocked.session.state.waitingFor ?? restoredUnlocked.session.state.turnPlayer);
    expect(getLuaRestoreLegalActionGroups(restoredUnlocked, 0)).toEqual(getGroupedDuelLegalActions(restoredUnlocked.session, 0));
    expect(getLuaRestoreLegalActions(restoredUnlocked, 0)).toEqual(getDuelLegalActions(restoredUnlocked.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredUnlocked, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredUnlocked, 0));
    const summon = getLuaRestoreLegalActions(restoredUnlocked, 0).find(
      (action) => action.type === "specialSummonProcedure" && action.uid === guardian!.uid,
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredUnlocked, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredUnlocked, summon!);

    expect(restoredUnlocked.session.state.cards.find((card) => card.uid === guardian!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restoredUnlocked.session.state.cards.find((card) => card.uid === gravityAxe!.uid)).toMatchObject({
      location: "spellTrapZone",
      faceUp: true,
    });
    expect(restoredUnlocked.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: guardian!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
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

function chainResponderScript(): string {
  return `
  local s,id=GetID()
  function s.initial_effect(c)
    local e=Effect.CreateEffect(c)
    e:SetType(EFFECT_TYPE_QUICK_O)
    e:SetRange(LOCATION_HAND)
    e:SetCode(EVENT_CHAINING)
    e:SetCondition(function() return Duel.GetCurrentChain()>0 end)
    e:SetOperation(function() Debug.Message("equip responder resolved") end)
    c:RegisterEffect(e)
  end
  `;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelResponse): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
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

function passRestoredBattleResponsesUntilTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function expectLuaEquipProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, equipCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${equipCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      Debug.Message("equip probe " .. equip:GetCode() .. "/" .. target:GetAttack())
    `,
    "equip-stat-lock-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}

function expectLuaEquipStatProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, equipCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${equipCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      Debug.Message("equip stat probe " .. equip:GetCode() .. "/" .. target:GetAttack() .. "/" .. target:GetDefense())
    `,
    "equip-stat-lock-stat-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}
