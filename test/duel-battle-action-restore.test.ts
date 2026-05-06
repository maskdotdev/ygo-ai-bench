import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { moveDuelCard } from "#duel/card-state.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("battle action restore", () => {
  it("restores direct attack legal actions and applies the restored action", () => {
    const session = createBattleSession(["100"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && !candidate.targetUid);
    expect(action).toBeDefined();

    const result = applyAndAssert(restored, action!);
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(restored.state.battleWindow).toMatchObject({ kind: "attackNegationResponse", responsePlayer: 1 });
  });

  it("restores targeted attack legal actions and applies the restored action", () => {
    const session = createBattleSession(["100"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === target!.uid);
    expect(action).toBeDefined();

    const result = applyAndAssert(restored, action!);
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.battleWindow).toMatchObject({ kind: "attackNegationResponse", responsePlayer: 1 });
  });

  it("restores attack response passes into the damage-step response window", () => {
    const session = createBattleSession(["100"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.battleWindow).toMatchObject({ kind: "attackNegationResponse", responsePlayer: 1 });
    const opponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passAttack");
    expect(opponentPass).toBeDefined();
    const staleBeforeOpponentPass = applyResponse(restored, { ...opponentPass!, windowId: opponentPass!.windowId! - 1 });
    expect(staleBeforeOpponentPass.ok).toBe(false);
    expect(staleBeforeOpponentPass.error).toContain("Response is not currently legal");
    expect(staleBeforeOpponentPass.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeOpponentPass.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(staleBeforeOpponentPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(staleBeforeOpponentPass.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeOpponentPass.legalActions);

    const afterOpponentPass = applyAndAssert(restored, opponentPass!);
    expect(afterOpponentPass.state).toMatchObject({ waitingFor: 0, windowKind: "battle", attackPasses: [1], battleWindow: { kind: "attackNegationResponse", responsePlayer: 0 } });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);

    const restoredTurnPassWindow = restoreDuel(serializeDuel(restored), createCardReader(cards));
    expect(restoredTurnPassWindow.state.attackPasses).toEqual([1]);
    expect(restoredTurnPassWindow.state.battleWindow).toEqual(restored.state.battleWindow);
    const turnPass = getDuelLegalActions(restoredTurnPassWindow, 0).find((action) => action.type === "passAttack");
    expect(turnPass).toBeDefined();
    const result = applyAndAssert(restoredTurnPassWindow, turnPass!);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", attackPasses: [], damagePasses: [], battleWindow: { kind: "startDamageStep", responsePlayer: 1 } });
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restoredTurnPassWindow, 0)).toEqual([]);
    assertStaleResponse(restoredTurnPassWindow, turnPass!);
  });

  it("returns restored battle quick chains to the battle response player", () => {
    const session = createBattleSession(["100", "300"], ["400", "500"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnQuickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(turnQuickSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    registerEffect(session, battleQuickEffect("restore-battle-turn-quick", turnQuickSource!.uid, 0, "Restored battle turn quick resolved"));
    registerEffect(session, chainOnlyBattleQuickEffect("restore-battle-opponent-chain-quick", opponentQuickSource!.uid, 1, "Restored battle opponent chain quick resolved"));
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-battle-turn-quick");
    expect(quick).toBeDefined();
    expect(applyAndAssert(session, quick!).state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-battle-turn-quick": restoreBattleQuickEffect("Restored battle turn quick resolved"),
      "restore-battle-opponent-chain-quick": restoreChainOnlyBattleQuickEffect("Restored battle opponent chain quick resolved"),
    });
    const restoredQuick = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-battle-turn-quick": restoreBattleQuickEffect("Restored battle turn quick resolved"),
      "restore-battle-opponent-chain-quick": restoreChainOnlyBattleQuickEffect("Restored battle opponent chain quick resolved"),
    });
    const opponentQuick = getDuelLegalActions(restoredQuick, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-battle-opponent-chain-quick");
    expect(opponentQuick).toBeDefined();
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    const quickResult = applyAndAssert(restoredQuick, opponentQuick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "attackNegationResponse", responsePlayer: 1 } });
    expect(restoredQuick.state.chain).toHaveLength(0);
    expect(restoredQuick.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored battle turn quick resolved")).toBe(true);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored battle opponent chain quick resolved")).toBe(true);
    expect(quickResult.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passAttack", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    assertStaleResponse(restoredQuick, opponentQuick!);

    const result = applyAndAssert(restored, pass!);

    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "attackNegationResponse", responsePlayer: 1 } });
    expect(restored.state.chain).toHaveLength(0);
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passAttack", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    assertStaleResponse(restored, pass!);
  });

  it("returns restored damage-step quick chains to the damage response player", () => {
    const session = createBattleSession(["100", "300"], ["400", "500"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnQuickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(turnQuickSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    registerEffect(session, damageStepQuickEffect("restore-damage-turn-quick", turnQuickSource!.uid, 0, "Restored damage turn quick resolved"));
    registerEffect(session, chainOnlyDamageStepQuickEffect("restore-damage-opponent-chain-quick", opponentQuickSource!.uid, 1, "Restored damage opponent chain quick resolved"));
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    expect(applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passAttack")!).state).toMatchObject({
      waitingFor: 1,
      windowKind: "battle",
      battleWindow: { kind: "startDamageStep", responsePlayer: 1 },
    });
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-damage-turn-quick");
    expect(quick).toBeDefined();
    expect(applyAndAssert(session, quick!).state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-damage-turn-quick": restoreDamageStepQuickEffect("Restored damage turn quick resolved"),
      "restore-damage-opponent-chain-quick": restoreChainOnlyDamageStepQuickEffect("Restored damage opponent chain quick resolved"),
    });
    const restoredQuick = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-damage-turn-quick": restoreDamageStepQuickEffect("Restored damage turn quick resolved"),
      "restore-damage-opponent-chain-quick": restoreChainOnlyDamageStepQuickEffect("Restored damage opponent chain quick resolved"),
    });
    const opponentQuick = getDuelLegalActions(restoredQuick, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-damage-opponent-chain-quick");
    expect(opponentQuick).toBeDefined();
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    const quickResult = applyAndAssert(restoredQuick, opponentQuick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "startDamageStep", responsePlayer: 1 } });
    expect(restoredQuick.state.chain).toHaveLength(0);
    expect(restoredQuick.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored damage turn quick resolved")).toBe(true);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored damage opponent chain quick resolved")).toBe(true);
    expect(quickResult.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    assertStaleResponse(restoredQuick, opponentQuick!);

    const result = applyAndAssert(restored, pass!);

    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "startDamageStep", responsePlayer: 1 } });
    expect(restored.state.chain).toHaveLength(0);
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    assertStaleResponse(restored, pass!);
  });

  it("returns restored damage-calculation quick chains to the damage-calculation response player", () => {
    const session = createBattleSession(["100", "300"], ["400", "500"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnQuickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(turnQuickSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    registerEffect(session, damageCalculationQuickEffect("restore-damage-calc-turn-quick", turnQuickSource!.uid, 0, "Restored damage calculation turn quick resolved"));
    registerEffect(session, chainOnlyDamageCalculationQuickEffect("restore-damage-calc-opponent-chain-quick", opponentQuickSource!.uid, 1, "Restored damage calculation opponent chain quick resolved"));
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    passBattleWindow(session, "passAttack");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    expect(session.state.battleWindow).toMatchObject({ kind: "duringDamageCalculation", responsePlayer: 1 });
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-damage-calc-turn-quick");
    expect(quick).toBeDefined();
    expect(applyAndAssert(session, quick!).state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-damage-calc-turn-quick": restoreDamageCalculationQuickEffect("Restored damage calculation turn quick resolved"),
      "restore-damage-calc-opponent-chain-quick": restoreChainOnlyDamageCalculationQuickEffect("Restored damage calculation opponent chain quick resolved"),
    });
    const restoredQuick = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-damage-calc-turn-quick": restoreDamageCalculationQuickEffect("Restored damage calculation turn quick resolved"),
      "restore-damage-calc-opponent-chain-quick": restoreChainOnlyDamageCalculationQuickEffect("Restored damage calculation opponent chain quick resolved"),
    });
    const opponentQuick = getDuelLegalActions(restoredQuick, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-damage-calc-opponent-chain-quick");
    expect(opponentQuick).toBeDefined();
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    const quickResult = applyAndAssert(restoredQuick, opponentQuick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 1 } });
    expect(restoredQuick.state.chain).toHaveLength(0);
    expect(restoredQuick.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored damage calculation turn quick resolved")).toBe(true);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored damage calculation opponent chain quick resolved")).toBe(true);
    expect(quickResult.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    assertStaleResponse(restoredQuick, opponentQuick!);

    const result = applyAndAssert(restored, pass!);

    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 1 } });
    expect(restored.state.chain).toHaveLength(0);
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    assertStaleResponse(restored, pass!);
  });
});

function createBattleSession(playerDeck: string[], opponentDeck: string[]) {
  const session = createDuel({ seed: 1, startingHandSize: Math.max(playerDeck.length, opponentDeck.length), cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: playerDeck },
    1: { main: opponentDeck },
  });
  startDuel(session);
  return session;
}

function passBattleWindow(session: ReturnType<typeof createDuel>, type: "passAttack" | "passDamage"): void {
  for (const player of [session.state.waitingFor!, session.state.waitingFor === 0 ? 1 : 0] as const) {
    const pass = getDuelLegalActions(session, player).find((action) => action.type === type);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function assertStaleResponse(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const stale = applyResponse(session, action);
  expect(stale.ok).toBe(false);
  expect(stale.error).toContain("Response is not currently legal");
  expect(stale.state.actionWindowId).toBe(session.state.actionWindowId);
  expect(stale.legalActions).toEqual(getDuelLegalActions(session, stale.state.waitingFor!));
  expect(stale.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, stale.state.waitingFor!));
  expect(stale.legalActionGroups.flatMap((group) => group.actions)).toEqual(stale.legalActions);
}

function battleQuickEffect(id: string, sourceUid: string, controller: 0 | 1, detail: string): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "quick",
    range: ["hand"],
    oncePerTurn: true,
    operation(ctx) {
      ctx.log(detail);
    },
  };
}

function chainOnlyBattleQuickEffect(id: string, sourceUid: string, controller: 0 | 1, detail: string): DuelEffectDefinition {
  return {
    ...battleQuickEffect(id, sourceUid, controller, detail),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

function restoreBattleQuickEffect(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...effect,
    operation(ctx) {
      ctx.log(detail);
    },
  });
}

function restoreChainOnlyBattleQuickEffect(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreBattleQuickEffect(detail)(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  });
}

function damageStepQuickEffect(id: string, sourceUid: string, controller: 0 | 1, detail: string): DuelEffectDefinition {
  return {
    ...battleQuickEffect(id, sourceUid, controller, detail),
    property: 0x4000,
  };
}

function chainOnlyDamageStepQuickEffect(id: string, sourceUid: string, controller: 0 | 1, detail: string): DuelEffectDefinition {
  return {
    ...damageStepQuickEffect(id, sourceUid, controller, detail),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

function restoreDamageStepQuickEffect(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreBattleQuickEffect(detail)(effect),
    property: 0x4000,
  });
}

function restoreChainOnlyDamageStepQuickEffect(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreDamageStepQuickEffect(detail)(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  });
}

function damageCalculationQuickEffect(id: string, sourceUid: string, controller: 0 | 1, detail: string): DuelEffectDefinition {
  return {
    ...battleQuickEffect(id, sourceUid, controller, detail),
    property: 0x8000,
  };
}

function chainOnlyDamageCalculationQuickEffect(id: string, sourceUid: string, controller: 0 | 1, detail: string): DuelEffectDefinition {
  return {
    ...damageCalculationQuickEffect(id, sourceUid, controller, detail),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

function restoreDamageCalculationQuickEffect(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreBattleQuickEffect(detail)(effect),
    property: 0x8000,
  });
}

function restoreChainOnlyDamageCalculationQuickEffect(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreDamageCalculationQuickEffect(detail)(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  });
}
