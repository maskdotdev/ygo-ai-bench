import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Union procedure actions", () => {
  it("restores Z-Metal Tank union target filter and equip attack/defense boosts", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const zMetalTankCode = "64500000";
    const xHeadCannonCode = "62651957";
    const yDragonHeadCode = "65622692";
    const decoyCode = "601030";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [zMetalTankCode, xHeadCannonCode, yDragonHeadCode].includes(card.code)),
      { code: decoyCode, name: "Z-Metal Tank Decoy", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1700, defense: 1100 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 298, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [zMetalTankCode, decoyCode, xHeadCannonCode, yDragonHeadCode] }, 1: { main: [] } });
    startDuel(session);

    const zMetalTank = session.state.cards.find((card) => card.code === zMetalTankCode);
    const xHeadCannon = session.state.cards.find((card) => card.code === xHeadCannonCode);
    const yDragonHead = session.state.cards.find((card) => card.code === yDragonHeadCode);
    const decoy = session.state.cards.find((card) => card.code === decoyCode);
    expect(zMetalTank).toBeDefined();
    expect(xHeadCannon).toBeDefined();
    expect(yDragonHead).toBeDefined();
    expect(decoy).toBeDefined();
    moveDuelCard(session.state, zMetalTank!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, decoy!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, xHeadCannon!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, yDragonHead!.uid, "monsterZone", 0).position = "faceUpAttack";
    zMetalTank!.sequence = 0;
    decoy!.sequence = 1;
    xHeadCannon!.sequence = 2;
    yDragonHead!.sequence = 3;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(zMetalTankCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipWindow.missingRegistryKeys).toEqual([]);
    expect(restoredEquipWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipWindow);
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredEquipWindow, 0));

    const equipAction = findEffectAction(restoredEquipWindow.session, getLuaRestoreLegalActions(restoredEquipWindow, 0), zMetalTank!.uid, 1068);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);
    resolveRestoredChain(restoredEquipWindow);

    expect(restoredEquipWindow.session.state.cards.find((card) => card.uid === zMetalTank!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: xHeadCannon!.uid,
      faceUp: true,
    });
    expect(restoredEquipWindow.session.state.cards.find((card) => card.uid === decoy!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredEquipWindow.session.state.cards.find((card) => card.uid === yDragonHead!.uid)).toMatchObject({ location: "monsterZone" });

    const restoredUnionState = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), workspace, reader);
    expect(restoredUnionState.restoreComplete, restoredUnionState.incompleteReasons.join("; ")).toBe(true);
    expect(restoredUnionState.missingRegistryKeys).toEqual([]);
    expect(restoredUnionState.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredUnionState);

    const restoredXHeadCannon = restoredUnionState.session.state.cards.find((card) => card.uid === xHeadCannon!.uid);
    const restoredDecoy = restoredUnionState.session.state.cards.find((card) => card.uid === decoy!.uid);
    const restoredYDragonHead = restoredUnionState.session.state.cards.find((card) => card.uid === yDragonHead!.uid);
    expect(currentAttack(restoredXHeadCannon, restoredUnionState.session.state)).toBe(2400);
    expect(currentDefense(restoredXHeadCannon, restoredUnionState.session.state)).toBe(2100);
    expect(currentAttack(restoredDecoy, restoredUnionState.session.state)).toBe(1700);
    expect(currentDefense(restoredDecoy, restoredUnionState.session.state)).toBe(1100);
    expect(currentAttack(restoredYDragonHead, restoredUnionState.session.state)).toBe(1500);
    expect(currentDefense(restoredYDragonHead, restoredUnionState.session.state)).toBe(1600);
    expectLuaUnionEquipStatProbe(restoredUnionState, xHeadCannonCode, zMetalTankCode, "union equip stat probe 64500000/2400/2100");
  });

  it("restores Union Driver equip and summon-back procedure windows", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const unionDriverCode = "99249638";
    const targetCode = "601005";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === unionDriverCode),
      { code: targetCode, name: "Union Procedure Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1600, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 294, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [unionDriverCode, targetCode] }, 1: { main: [] } });
    startDuel(session);

    const unionDriver = session.state.cards.find((card) => card.code === unionDriverCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(unionDriver).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, unionDriver!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(unionDriverCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipWindow.missingRegistryKeys).toEqual([]);
    expect(restoredEquipWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipWindow);
    expect(getLuaRestoreLegalActions(restoredEquipWindow, 0)).toEqual(getDuelLegalActions(restoredEquipWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredEquipWindow, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredEquipWindow, 0));

    const equipAction = findEffectAction(restoredEquipWindow.session, getLuaRestoreLegalActions(restoredEquipWindow, 0), unionDriver!.uid, 1068);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);
    resolveRestoredChain(restoredEquipWindow);

    const equippedUnion = restoredEquipWindow.session.state.cards.find((card) => card.uid === unionDriver!.uid);
    expect(equippedUnion).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid });
    expect(equippedUnion?.previousEquippedToUid).toBeUndefined();

    const restoredUnionStateWindow = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), workspace, reader);
    expect(restoredUnionStateWindow.restoreComplete, restoredUnionStateWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredUnionStateWindow.missingRegistryKeys).toEqual([]);
    expect(restoredUnionStateWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredUnionStateWindow);
    expect(findEffectAction(restoredUnionStateWindow.session, getLuaRestoreLegalActions(restoredUnionStateWindow, 0), unionDriver!.uid, 2)).toBeUndefined();

    endTurnAndAssert(restoredUnionStateWindow, 0);
    endTurnAndAssert(restoredUnionStateWindow, 1);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(restoredUnionStateWindow.session), workspace, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow);
    expect(getLuaRestoreLegalActions(restoredSummonWindow, 0)).toEqual(getDuelLegalActions(restoredSummonWindow.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredSummonWindow, 0));

    const summonBackAction = findEffectAction(restoredSummonWindow.session, getLuaRestoreLegalActions(restoredSummonWindow, 0), unionDriver!.uid, 2);
    expect(summonBackAction, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredSummonWindow, summonBackAction!);
    resolveRestoredChain(restoredSummonWindow);

    expect(restoredSummonWindow.session.state.cards.find((card) => card.uid === unionDriver!.uid)).toMatchObject({
      location: "monsterZone",
      previousEquippedToUid: target!.uid,
    });
    expect(restoredSummonWindow.session.state.cards.find((card) => card.uid === unionDriver!.uid)?.equippedToUid).toBeUndefined();
    expect(restoredSummonWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });
  });

  it("restores Union Driver replacing itself with a Union from Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const unionDriverCode = "99249638";
    const platformCode = "23265594";
    const targetCode = "601006";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [unionDriverCode, platformCode].includes(card.code)),
      { code: targetCode, name: "Union Driver Deck Equip Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1600, defense: 1200, race: 0x20 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 295, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [unionDriverCode, targetCode, platformCode] }, 1: { main: [] } });
    startDuel(session);

    const unionDriver = session.state.cards.find((card) => card.code === unionDriverCode);
    const platform = session.state.cards.find((card) => card.code === platformCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(unionDriver).toBeDefined();
    expect(platform).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, unionDriver!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(unionDriverCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(platformCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipWindow.missingRegistryKeys).toEqual([]);
    expect(restoredEquipWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipWindow);
    const equipAction = findEffectAction(restoredEquipWindow.session, getLuaRestoreLegalActions(restoredEquipWindow, 0), unionDriver!.uid, 1068);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);
    resolveRestoredChain(restoredEquipWindow);

    const restoredDriverDeckEquipWindow = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), workspace, reader);
    expect(restoredDriverDeckEquipWindow.restoreComplete, restoredDriverDeckEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDriverDeckEquipWindow.missingRegistryKeys).toEqual([]);
    expect(restoredDriverDeckEquipWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDriverDeckEquipWindow);
    const driverDeckEquipAction = findEffectActionByCategory(restoredDriverDeckEquipWindow.session, getLuaRestoreLegalActions(restoredDriverDeckEquipWindow, 0), unionDriver!.uid, 0x40000);
    expect(driverDeckEquipAction, JSON.stringify(getLuaRestoreLegalActions(restoredDriverDeckEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDriverDeckEquipWindow, driverDeckEquipAction!);
    resolveRestoredChain(restoredDriverDeckEquipWindow);

    expect(restoredDriverDeckEquipWindow.session.state.cards.find((card) => card.uid === unionDriver!.uid)).toMatchObject({ location: "banished", previousEquippedToUid: target!.uid });
    expect(restoredDriverDeckEquipWindow.session.state.cards.find((card) => card.uid === platform!.uid)).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid });
    expect(restoredDriverDeckEquipWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });

    const restoredPlatformStateWindow = restoreDuelWithLuaScripts(serializeDuel(restoredDriverDeckEquipWindow.session), workspace, reader);
    expect(restoredPlatformStateWindow.restoreComplete, restoredPlatformStateWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPlatformStateWindow.missingRegistryKeys).toEqual([]);
    expect(restoredPlatformStateWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredPlatformStateWindow);
    expect(
      restoredPlatformStateWindow.session.state.effects.filter(
        (effect) => effect.sourceUid === platform!.uid && (effect.code === 76 || effect.code === 347),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 76,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-12-76",
          "lifePointValue": [Function],
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 1024,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:23265594:lua-12-76",
          "reset": {
            "flags": 33427456,
          },
          "sourceUid": "p0-deck-23265594-2",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
        {
          "canActivate": [Function],
          "code": 347,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-13-347",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 1024,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:23265594:lua-13-347",
          "reset": {
            "flags": 33427456,
          },
          "sourceUid": "p0-deck-23265594-2",
          "target": [Function],
        },
      ]
    `);
    expect(restoredPlatformStateWindow.session.state.cards.find((card) => card.uid === platform!.uid)).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid });
  });

  it("restores Union Pilot cost-to-hand, banished Union equip, and self Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const unionPilotCode = "89357740";
    const unionDriverCode = "99249638";
    const targetCode = "601027";
    const responderCode = "601028";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [unionPilotCode, unionDriverCode].includes(card.code)),
      { code: targetCode, name: "Union Pilot Effect Target", kind: "monster" as const, typeFlags: 0x21, level: 4, attack: 1600, defense: 1200 },
      { code: responderCode, name: "Union Pilot Chain Responder", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 297, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [unionPilotCode, unionDriverCode, targetCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const unionPilot = session.state.cards.find((card) => card.code === unionPilotCode);
    const unionDriver = session.state.cards.find((card) => card.code === unionDriverCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(unionPilot).toBeDefined();
    expect(unionDriver).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, unionPilot!.uid, "spellTrapZone", 0).position = "faceUpAttack";
    unionPilot!.equippedToUid = target!.uid;
    unionPilot!.faceUp = true;
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, unionDriver!.uid, "banished", 0);
    unionDriver!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript("union pilot responder resolved");
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(unionPilotCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(unionDriverCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const restoredEquippedState = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredEquippedState.restoreComplete, restoredEquippedState.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquippedState.missingRegistryKeys).toEqual([]);
    expect(restoredEquippedState.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquippedState);
    expect(restoredEquippedState.session.state.cards.find((card) => card.uid === unionPilot!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      faceUp: true,
    });

    const pilotEquipSummon = findEffectActionByCategory(restoredEquippedState.session, getLuaRestoreLegalActions(restoredEquippedState, 0), unionPilot!.uid, 0x40200);
    expect(pilotEquipSummon, JSON.stringify(getLuaRestoreLegalActions(restoredEquippedState, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquippedState, pilotEquipSummon!);

    expect(restoredEquippedState.session.state.cards.find((card) => card.uid === unionPilot!.uid)).toMatchObject({
      location: "hand",
      controller: 0,
      previousEquippedToUid: target!.uid,
    });
    expect(restoredEquippedState.session.state.chain).toHaveLength(1);
    expect(restoredEquippedState.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-5",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 262144,
            "count": 1,
            "parameter": 32,
            "player": 0,
            "targetUids": [],
          },
          {
            "category": 512,
            "count": 1,
            "parameter": 2,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-89357740-0",
      }
    `);
    expect(restoredEquippedState.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x40000, targetUids: [], count: 1, player: 0, parameter: 0x20 },
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquippedState.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain);
    expect(restoredChain.session.state.chain[0]).toEqual(restoredEquippedState.session.state.chain[0]!);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === unionDriver!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      faceUp: true,
    });
    expect(restoredChain.session.state.cards.find((card) => card.uid === unionPilot!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });

    const restoredDriverState = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredDriverState.restoreComplete, restoredDriverState.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDriverState.missingRegistryKeys).toEqual([]);
    expect(restoredDriverState.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDriverState);
    expect(
      restoredDriverState.session.state.effects.filter(
        (effect) => effect.sourceUid === unionDriver!.uid && (effect.code === 76 || effect.code === 347),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 76,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-12-76",
          "lifePointValue": [Function],
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 1024,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:99249638:lua-12-76",
          "reset": {
            "flags": 33427456,
          },
          "sourceUid": "p0-deck-99249638-1",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
        {
          "canActivate": [Function],
          "code": 347,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-13-347",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 1024,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:99249638:lua-13-347",
          "reset": {
            "flags": 33427456,
          },
          "sourceUid": "p0-deck-99249638-1",
          "target": [Function],
        },
      ]
    `);
    expect(restoredChain.host.messages).not.toContain("union pilot responder resolved");
  });

  it("restores Trigon old-union battle-destroying Special Summon trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const trigonCode = "48568432";
    const targetCode = "601024";
    const battleTargetCode = "601025";
    const graveMachineCode = "601026";
    const cards = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === trigonCode),
      { code: targetCode, name: "Trigon Union Battle Target", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1800, defense: 1200, race: 0x20 },
      { code: battleTargetCode, name: "Trigon Battle Victim", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: graveMachineCode, name: "Trigon Graveyard Machine", kind: "monster" as const, typeFlags: 0x1, level: 4, attack: 1200, defense: 1000, race: 0x20, attribute: 0x10 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 296, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [trigonCode, targetCode, graveMachineCode] }, 1: { main: [battleTargetCode] } });
    startDuel(session);

    const trigon = session.state.cards.find((card) => card.code === trigonCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const battleTarget = session.state.cards.find((card) => card.code === battleTargetCode);
    const graveMachine = session.state.cards.find((card) => card.code === graveMachineCode);
    expect(trigon).toBeDefined();
    expect(target).toBeDefined();
    expect(battleTarget).toBeDefined();
    expect(graveMachine).toBeDefined();
    moveDuelCard(session.state, trigon!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, battleTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, graveMachine!.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(trigonCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipWindow.missingRegistryKeys).toEqual([]);
    expect(restoredEquipWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipWindow);
    const equipAction = findEffectAction(restoredEquipWindow.session, getLuaRestoreLegalActions(restoredEquipWindow, 0), trigon!.uid, 1068);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);
    resolveRestoredChain(restoredEquipWindow);

    expect(restoredEquipWindow.session.state.cards.find((card) => card.uid === trigon!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: target!.uid,
      faceUp: true,
    });

    const restoredUnionState = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), workspace, reader);
    expect(restoredUnionState.restoreComplete, restoredUnionState.incompleteReasons.join("; ")).toBe(true);
    expect(restoredUnionState.missingRegistryKeys).toEqual([]);
    expect(restoredUnionState.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredUnionState);
    expect(
      restoredUnionState.session.state.effects.filter(
        (effect) => effect.sourceUid === trigon!.uid && (effect.code === 347 || effect.code === 348),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 347,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-7-347",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 1024,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:48568432:lua-7-347",
          "reset": {
            "flags": 33427456,
          },
          "sourceUid": "p0-deck-48568432-0",
          "target": [Function],
        },
        {
          "canActivate": [Function],
          "code": 348,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-8-348",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 1024,
          "range": [
            "spellTrapZone",
          ],
          "registryKey": "lua:48568432:lua-8-348",
          "reset": {
            "flags": 33427456,
          },
          "sourceUid": "p0-deck-48568432-0",
          "target": [Function],
        },
      ]
    `);

    restoredUnionState.session.state.phase = "battle";
    restoredUnionState.session.state.waitingFor = 0;
    const restoredBattleWindow = restoreDuelWithLuaScripts(serializeDuel(restoredUnionState.session), workspace, reader);
    expect(restoredBattleWindow.restoreComplete, restoredBattleWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattleWindow.missingRegistryKeys).toEqual([]);
    expect(restoredBattleWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredBattleWindow);
    const attack = getLuaRestoreLegalActions(restoredBattleWindow, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === target!.uid && action.targetUid === battleTarget!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattleWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattleWindow, attack!);
    passRestoredBattleResponsesUntilTrigger(restoredBattleWindow);

    expect(restoredBattleWindow.session.state.cards.find((card) => card.uid === battleTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredBattleWindow.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-5-1139",
          "eventCardUid": "p0-deck-601024-1",
          "eventCode": 1140,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "battleDestroyed",
          "eventPlayer": 1,
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 2,
          },
          "eventReason": 33,
          "eventReasonCardUid": "p0-deck-601024-1",
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "trigger-9-1",
          "player": 0,
          "sourceUid": "p0-deck-48568432-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattleWindow.session), workspace, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === trigon!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, trigger!);

    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([]);
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === graveMachine!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
    });
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: battleTarget!.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: target!.uid,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: graveMachine!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: trigon!.uid,
        eventReasonEffectId: 5,
        eventUids: [graveMachine!.uid],
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
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function chainResponderScript(message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function findEffectAction(session: DuelSession, actions: DuelAction[], uid: string, description: number): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    return session.state.effects.find((effect) => effect.id === action.effectId && effect.sourceUid === uid)?.description === description;
  });
}

function findEffectActionByCategory(session: DuelSession, actions: DuelAction[], uid: string, category: number): Extract<DuelAction, { type: "activateEffect" }> | undefined {
  return actions.find((action): action is Extract<DuelAction, { type: "activateEffect" }> => {
    if (action.type !== "activateEffect" || action.uid !== uid) return false;
    const effect = session.state.effects.find((candidate) => candidate.id === action.effectId && candidate.sourceUid === uid);
    return effect?.category === category && effect.description !== 1068;
  });
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expectRestoredLegalActions(restored);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  }
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
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

function endTurnAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  const endTurn = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "endTurn");
  expect(endTurn, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, endTurn!);
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

function expectLuaUnionEquipStatProbe(restored: ReturnType<typeof restoreDuelWithLuaScripts>, targetCode: string, equipCode: string, expected: string): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${targetCode}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local equip=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${equipCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      Debug.Message("union equip stat probe " .. equip:GetCode() .. "/" .. target:GetAttack() .. "/" .. target:GetDefense())
    `,
    "union-equip-stat-probe.lua",
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(expected);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(getLuaRestoreLegalActions(restored, waitingFor)).toEqual(getDuelLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor)).toEqual(getGroupedDuelLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
