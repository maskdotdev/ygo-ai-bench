import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelAction, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Union procedure actions", () => {
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
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
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
    expect(findEffectAction(restoredUnionStateWindow.session, getLuaRestoreLegalActions(restoredUnionStateWindow, 0), unionDriver!.uid, 2)).toBeUndefined();

    endTurnAndAssert(restoredUnionStateWindow, 0);
    endTurnAndAssert(restoredUnionStateWindow, 1);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(restoredUnionStateWindow.session), workspace, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
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
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    const equipAction = findEffectAction(restoredEquipWindow.session, getLuaRestoreLegalActions(restoredEquipWindow, 0), unionDriver!.uid, 1068);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);
    resolveRestoredChain(restoredEquipWindow);

    const restoredDriverDeckEquipWindow = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), workspace, reader);
    expect(restoredDriverDeckEquipWindow.restoreComplete, restoredDriverDeckEquipWindow.incompleteReasons.join("; ")).toBe(true);
    const driverDeckEquipAction = findEffectActionByCategory(restoredDriverDeckEquipWindow.session, getLuaRestoreLegalActions(restoredDriverDeckEquipWindow, 0), unionDriver!.uid, 0x40000);
    expect(driverDeckEquipAction, JSON.stringify(getLuaRestoreLegalActions(restoredDriverDeckEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDriverDeckEquipWindow, driverDeckEquipAction!);
    resolveRestoredChain(restoredDriverDeckEquipWindow);

    expect(restoredDriverDeckEquipWindow.session.state.cards.find((card) => card.uid === unionDriver!.uid)).toMatchObject({ location: "banished", previousEquippedToUid: target!.uid });
    expect(restoredDriverDeckEquipWindow.session.state.cards.find((card) => card.uid === platform!.uid)).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid });
    expect(restoredDriverDeckEquipWindow.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });

    const restoredPlatformStateWindow = restoreDuelWithLuaScripts(serializeDuel(restoredDriverDeckEquipWindow.session), workspace, reader);
    expect(restoredPlatformStateWindow.restoreComplete, restoredPlatformStateWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPlatformStateWindow.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: platform!.uid, code: 76 }),
        expect.objectContaining({ sourceUid: platform!.uid, code: 347 }),
      ]),
    );
    expect(restoredPlatformStateWindow.session.state.cards.find((card) => card.uid === platform!.uid)).toMatchObject({ location: "spellTrapZone", equippedToUid: target!.uid });
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
    expect(host.registerInitialEffects()).toBeGreaterThan(0);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
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
    expect(restoredUnionState.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: trigon!.uid, code: 347 }),
        expect.objectContaining({ sourceUid: trigon!.uid, code: 348 }),
      ]),
    );

    restoredUnionState.session.state.phase = "battle";
    restoredUnionState.session.state.waitingFor = 0;
    const restoredBattleWindow = restoreDuelWithLuaScripts(serializeDuel(restoredUnionState.session), workspace, reader);
    expect(restoredBattleWindow.restoreComplete, restoredBattleWindow.incompleteReasons.join("; ")).toBe(true);
    const attack = getLuaRestoreLegalActions(restoredBattleWindow, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === target!.uid && action.targetUid === battleTarget!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredBattleWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredBattleWindow, attack!);
    passRestoredBattleResponsesUntilTrigger(restoredBattleWindow);

    expect(restoredBattleWindow.session.state.cards.find((card) => card.uid === battleTarget!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredBattleWindow.session.state.pendingTriggers).toEqual([
      expect.objectContaining({ sourceUid: trigon!.uid, eventName: "battleDestroyed", eventCardUid: target!.uid, player: 0 }),
    ]);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattleWindow.session), workspace, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === trigon!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTriggerWindow, trigger!);

    expect(restoredTriggerWindow.session.state.pendingTriggers).toEqual([]);
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === graveMachine!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
    });
    expect(restoredTriggerWindow.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "battleDestroyed", eventCode: 1140, eventCardUid: battleTarget!.uid }),
        expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102, eventCardUid: graveMachine!.uid }),
      ]),
    );
  });
});

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
  assertLegalActions(restored);
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

function assertLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(getLuaRestoreLegalActions(restored, waitingFor)).toEqual(getDuelLegalActions(restored.session, waitingFor));
  expect(getLuaRestoreLegalActionGroups(restored, waitingFor).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
