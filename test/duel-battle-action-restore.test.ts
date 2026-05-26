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
    assertLegalWindow(restored, staleBeforeOpponentPass, 1);

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

  it("restores damage response passes into the next damage window", () => {
    const session = createBattleSession(["100"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passAttack")!);
    expect(session.state.battleWindow).toMatchObject({ kind: "startDamageStep", responsePlayer: 1 });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const opponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passDamage");
    expect(opponentPass).toBeDefined();
    const afterOpponentPass = applyAndAssert(restored, opponentPass!);
    expect(afterOpponentPass.state).toMatchObject({ waitingFor: 0, windowKind: "battle", damagePasses: [1], battleWindow: { kind: "startDamageStep", responsePlayer: 0 } });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);

    const restoredTurnPassWindow = restoreDuel(serializeDuel(restored), createCardReader(cards));
    expect(restoredTurnPassWindow.state.damagePasses).toEqual([1]);
    expect(restoredTurnPassWindow.state.battleWindow).toEqual(restored.state.battleWindow);
    const turnPass = getDuelLegalActions(restoredTurnPassWindow, 0).find((action) => action.type === "passDamage");
    expect(turnPass).toBeDefined();
    const staleBeforeTurnPass = applyResponse(restoredTurnPassWindow, { ...turnPass!, windowId: turnPass!.windowId! - 1 });
    expect(staleBeforeTurnPass.ok).toBe(false);
    expect(staleBeforeTurnPass.error).toContain("Response is not currently legal");
    expect(staleBeforeTurnPass.state.actionWindowId).toBe(restoredTurnPassWindow.state.actionWindowId);
    expect(staleBeforeTurnPass.legalActions).toEqual(getDuelLegalActions(restoredTurnPassWindow, 0));
    expect(staleBeforeTurnPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTurnPassWindow, 0));
    assertLegalWindow(restoredTurnPassWindow, staleBeforeTurnPass, 0);

    const result = applyAndAssert(restoredTurnPassWindow, turnPass!);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleWindow: { kind: "beforeDamageCalculation", responsePlayer: 1 } });
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restoredTurnPassWindow, 0)).toEqual([]);
    assertStaleResponse(restoredTurnPassWindow, turnPass!);
  });

  it("restores before-damage-calculation passes into damage calculation", () => {
    const session = createBattleSession(["100"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    passBattleWindow(session, "passAttack");
    passBattleWindow(session, "passDamage");
    expect(session.state.battleWindow).toMatchObject({ kind: "beforeDamageCalculation", responsePlayer: 1 });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const opponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passDamage");
    expect(opponentPass).toBeDefined();
    const afterOpponentPass = applyAndAssert(restored, opponentPass!);
    expect(afterOpponentPass.state).toMatchObject({ waitingFor: 0, windowKind: "battle", damagePasses: [1], battleWindow: { kind: "beforeDamageCalculation", responsePlayer: 0 } });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);

    const restoredTurnPassWindow = restoreDuel(serializeDuel(restored), createCardReader(cards));
    expect(restoredTurnPassWindow.state.damagePasses).toEqual([1]);
    expect(restoredTurnPassWindow.state.battleWindow).toEqual(restored.state.battleWindow);
    const turnPass = getDuelLegalActions(restoredTurnPassWindow, 0).find((action) => action.type === "passDamage");
    expect(turnPass).toBeDefined();
    const result = applyAndAssert(restoredTurnPassWindow, turnPass!);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleStep: "damageCalculation", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 1 } });
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restoredTurnPassWindow, 0)).toEqual([]);
    assertStaleResponse(restoredTurnPassWindow, turnPass!);
  });

  it("restores during-damage-calculation passes into after damage calculation", () => {
    const session = createBattleSession(["100"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    passBattleWindow(session, "passAttack");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    expect(session.state.battleWindow).toMatchObject({ kind: "duringDamageCalculation", responsePlayer: 1 });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const opponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passDamage");
    expect(opponentPass).toBeDefined();
    const afterOpponentPass = applyAndAssert(restored, opponentPass!);
    expect(afterOpponentPass.state).toMatchObject({ waitingFor: 0, windowKind: "battle", damagePasses: [1], battleWindow: { kind: "duringDamageCalculation", responsePlayer: 0 } });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);

    const restoredTurnPassWindow = restoreDuel(serializeDuel(restored), createCardReader(cards));
    expect(restoredTurnPassWindow.state.damagePasses).toEqual([1]);
    expect(restoredTurnPassWindow.state.battleWindow).toEqual(restored.state.battleWindow);
    const turnPass = getDuelLegalActions(restoredTurnPassWindow, 0).find((action) => action.type === "passDamage");
    expect(turnPass).toBeDefined();
    const result = applyAndAssert(restoredTurnPassWindow, turnPass!);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleStep: "damage", battleWindow: { kind: "afterDamageCalculation", responsePlayer: 1 } });
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restoredTurnPassWindow, 0)).toEqual([]);
    assertStaleResponse(restoredTurnPassWindow, turnPass!);
  });

  it("restores after-damage-calculation passes into end damage step", () => {
    const session = createBattleSession(["100"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    passBattleWindow(session, "passAttack");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    expect(session.state.battleWindow).toMatchObject({ kind: "afterDamageCalculation", responsePlayer: 1 });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const opponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passDamage");
    expect(opponentPass).toBeDefined();
    const afterOpponentPass = applyAndAssert(restored, opponentPass!);
    expect(afterOpponentPass.state).toMatchObject({ waitingFor: 0, windowKind: "battle", damagePasses: [1], battleWindow: { kind: "afterDamageCalculation", responsePlayer: 0 } });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);

    const restoredTurnPassWindow = restoreDuel(serializeDuel(restored), createCardReader(cards));
    expect(restoredTurnPassWindow.state.damagePasses).toEqual([1]);
    expect(restoredTurnPassWindow.state.battleWindow).toEqual(restored.state.battleWindow);
    const turnPass = getDuelLegalActions(restoredTurnPassWindow, 0).find((action) => action.type === "passDamage");
    expect(turnPass).toBeDefined();
    const result = applyAndAssert(restoredTurnPassWindow, turnPass!);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleStep: "damage", battleWindow: { kind: "endDamageStep", responsePlayer: 1 } });
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(getDuelLegalActions(restoredTurnPassWindow, 0)).toEqual([]);
    assertStaleResponse(restoredTurnPassWindow, turnPass!);
  });

  it("restores end-damage-step passes into battle cleanup", () => {
    const session = createBattleSession(["100"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    passBattleWindow(session, "passAttack");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    advanceToEndDamageStep(session);
    expect(session.state.battleWindow).toMatchObject({ kind: "endDamageStep", responsePlayer: 1 });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const opponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passDamage");
    expect(opponentPass).toBeDefined();
    const afterOpponentPass = applyAndAssert(restored, opponentPass!);
    expect(afterOpponentPass.state).toMatchObject({ waitingFor: 0, windowKind: "battle", damagePasses: [1], battleWindow: { kind: "endDamageStep", responsePlayer: 0 }, players: { 1: { lifePoints: 6200 } } });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);

    const restoredTurnPassWindow = restoreDuel(serializeDuel(restored), createCardReader(cards));
    expect(restoredTurnPassWindow.state.damagePasses).toEqual([1]);
    expect(restoredTurnPassWindow.state.battleWindow).toEqual(restored.state.battleWindow);
    const turnPass = getDuelLegalActions(restoredTurnPassWindow, 0).find((action) => action.type === "passDamage");
    expect(turnPass).toBeDefined();
    const result = applyAndAssert(restoredTurnPassWindow, turnPass!);
    expect(result.state).toMatchObject({ waitingFor: 0, windowKind: "open", damagePasses: [], players: { 1: { lifePoints: 6200 } } });
    expect(result.state.battleWindow).toBeUndefined();
    expect(restoredTurnPassWindow.state.pendingBattle).toBeUndefined();
    expect(getDuelLegalActions(restoredTurnPassWindow, 1)).toEqual([]);
    assertStaleResponse(restoredTurnPassWindow, turnPass!);
  });

  it("queues restored battle damage triggers after end-damage-step cleanup", () => {
    const session = createBattleSession(["100", "300"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    registerEffect(session, battleDamageTrigger("restore-battle-damage-trigger", triggerSource!.uid, "Restored battle damage trigger resolved"));
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    passBattleWindow(session, "passAttack");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    advanceToEndDamageStep(session);
    expect(session.state.battleWindow).toMatchObject({ kind: "afterDamageCalculation", responsePlayer: 1 });
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-battle-damage-trigger", eventName: "battleDamageDealt", eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 }),
    ]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-battle-damage-trigger": restoreBattleDamageTrigger("Restored battle damage trigger resolved"),
    });
    expect(restored.state).toMatchObject({ waitingFor: 0, players: { 1: { lifePoints: 6200 } } });
    expect(restored.state.pendingBattle).toBeDefined();
    expect(restored.state.battleWindow).toMatchObject({ kind: "afterDamageCalculation" });
    expect(restored.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-battle-damage-trigger", eventName: "battleDamageDealt", eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 }),
    ]);
    expect(restored.state.log.some((entry) => entry.detail === "Restored battle damage trigger resolved")).toBe(false);

    const restoredTriggerWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), {
      "restore-battle-damage-trigger": restoreBattleDamageTrigger("Restored battle damage trigger resolved"),
    });
    expect(restoredTriggerWindow.state.pendingTriggers).toEqual(restored.state.pendingTriggers);
    const trigger = getDuelLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-battle-damage-trigger");
    expect(trigger).toBeDefined();
    const staleBeforeTrigger = applyResponse(restoredTriggerWindow, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleBeforeTrigger.ok).toBe(false);
    expect(staleBeforeTrigger.error).toContain("Response is not currently legal");
    expect(staleBeforeTrigger.legalActions).toEqual(getDuelLegalActions(restoredTriggerWindow, 0));
    expect(staleBeforeTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerWindow, 0));
    assertLegalWindow(restoredTriggerWindow, staleBeforeTrigger, 0);
    const triggerResult = applyAndAssert(restoredTriggerWindow, trigger!);
    expect(triggerResult.state.pendingTriggers).toEqual([]);
    expect(triggerResult.state.log.some((entry) => entry.detail === "Restored battle damage trigger resolved")).toBe(true);
    assertStaleResponse(restoredTriggerWindow, trigger!);
  });

  it("queues restored before-battle-damage triggers after end-damage-step cleanup", () => {
    const session = createBattleSession(["100", "300"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    registerEffect(session, beforeBattleDamageTrigger("restore-before-battle-damage-trigger", triggerSource!.uid, "Restored before battle damage trigger resolved"));
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    passBattleWindow(session, "passAttack");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    advanceToEndDamageStep(session);
    expect(session.state.battleWindow).toMatchObject({ kind: "afterDamageCalculation", responsePlayer: 1 });
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-before-battle-damage-trigger", eventName: "beforeBattleDamage", eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 }),
    ]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-before-battle-damage-trigger": restoreBeforeBattleDamageTrigger("Restored before battle damage trigger resolved"),
    });
    expect(restored.state).toMatchObject({ waitingFor: 0, players: { 1: { lifePoints: 6200 } } });
    expect(restored.state.pendingBattle).toBeDefined();
    expect(restored.state.battleWindow).toMatchObject({ kind: "afterDamageCalculation" });
    expect(restored.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-before-battle-damage-trigger", eventName: "beforeBattleDamage", eventPlayer: 1, eventValue: 1800, eventReason: 0x20, eventReasonPlayer: 0 }),
    ]);
    expect(restored.state.log.some((entry) => entry.detail === "Restored before battle damage trigger resolved")).toBe(false);

    const restoredTriggerWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), {
      "restore-before-battle-damage-trigger": restoreBeforeBattleDamageTrigger("Restored before battle damage trigger resolved"),
    });
    expect(restoredTriggerWindow.state.pendingTriggers).toEqual(restored.state.pendingTriggers);
    const trigger = getDuelLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-before-battle-damage-trigger");
    expect(trigger).toBeDefined();
    const staleBeforeTrigger = applyResponse(restoredTriggerWindow, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleBeforeTrigger.ok).toBe(false);
    expect(staleBeforeTrigger.error).toContain("Response is not currently legal");
    expect(staleBeforeTrigger.legalActions).toEqual(getDuelLegalActions(restoredTriggerWindow, 0));
    expect(staleBeforeTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerWindow, 0));
    assertLegalWindow(restoredTriggerWindow, staleBeforeTrigger, 0);
    const triggerResult = applyAndAssert(restoredTriggerWindow, trigger!);
    expect(triggerResult.state.pendingTriggers).toEqual([]);
    expect(triggerResult.state.log.some((entry) => entry.detail === "Restored before battle damage trigger resolved")).toBe(true);
    assertStaleResponse(restoredTriggerWindow, trigger!);
  });

  it("progresses restored battle cleanup trigger buckets after one trigger resolves", () => {
    const session = createBattleSession(["100", "300", "500"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const beforeSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const damageSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(attacker).toBeTruthy();
    expect(beforeSource).toBeTruthy();
    expect(damageSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    registerEffect(session, beforeBattleDamageTrigger("restore-before-battle-damage-bucket-trigger", beforeSource!.uid, "Restored before battle damage bucket trigger resolved"));
    registerEffect(session, battleDamageTrigger("restore-battle-damage-bucket-trigger", damageSource!.uid, "Restored battle damage bucket trigger resolved"));
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    passBattleWindow(session, "passAttack");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    advanceToEndDamageStep(session);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), battleCleanupTriggerRegistry());
    expect(restored.state).toMatchObject({ waitingFor: 0, players: { 1: { lifePoints: 6200 } } });
    expect(restored.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-before-battle-damage-bucket-trigger", "restore-battle-damage-bucket-trigger"]);

    const restoredTriggerWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), battleCleanupTriggerRegistry());
    const beforeTrigger = getDuelLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-before-battle-damage-bucket-trigger");
    expect(beforeTrigger).toBeDefined();
    const afterBeforeTrigger = applyAndAssert(restoredTriggerWindow, beforeTrigger!);
    expect(afterBeforeTrigger.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(afterBeforeTrigger.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-battle-damage-bucket-trigger", eventName: "battleDamageDealt", eventPlayer: 1, eventValue: 1800 }),
    ]);
    expect(afterBeforeTrigger.state.log.some((entry) => entry.detail === "Restored before battle damage bucket trigger resolved")).toBe(true);
    expect(afterBeforeTrigger.state.log.some((entry) => entry.detail === "Restored battle damage bucket trigger resolved")).toBe(false);
    const staleBeforeTrigger = applyResponse(restoredTriggerWindow, beforeTrigger!);
    expect(staleBeforeTrigger.ok).toBe(false);
    expect(staleBeforeTrigger.error).toContain("Response is not currently legal");
    expect(staleBeforeTrigger.legalActions).toEqual(getDuelLegalActions(restoredTriggerWindow, 0));
    expect(staleBeforeTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerWindow, 0));
    assertLegalWindow(restoredTriggerWindow, staleBeforeTrigger, 0);

    const restoredSecondTriggerWindow = restoreDuel(serializeDuel(restoredTriggerWindow), createCardReader(cards), battleCleanupTriggerRegistry());
    const damageTrigger = getDuelLegalActions(restoredSecondTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-battle-damage-bucket-trigger");
    expect(damageTrigger).toBeDefined();
    const damageTriggerResult = applyAndAssert(restoredSecondTriggerWindow, damageTrigger!);
    expect(damageTriggerResult.state.pendingTriggers).toEqual([]);
    expect(damageTriggerResult.state.log.some((entry) => entry.detail === "Restored battle damage bucket trigger resolved")).toBe(true);
    assertStaleResponse(restoredSecondTriggerWindow, damageTrigger!);
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
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 1), 1)).toBe(true);
    const opponentQuick = getDuelLegalActions(restoredQuick, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-battle-opponent-chain-quick");
    expect(opponentQuick).toBeDefined();
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredQuick, 1), 1, "restore-battle-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    const quickResult = applyAndAssert(restoredQuick, opponentQuick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "attackNegationResponse", responsePlayer: 1 } });
    expect(restoredQuick.state.chain).toHaveLength(0);
    expect(restoredQuick.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored battle turn quick resolved")).toBe(true);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored battle opponent chain quick resolved")).toBe(true);
    expect(quickResult.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passAttack", player: 1, windowKind: "battle" })]));
    expect(quickResult.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-battle-opponent-chain-quick")).toBe(false);
    expect(hasGroupedEffect(quickResult.legalActionGroups, 1, "restore-battle-opponent-chain-quick", "battle")).toBe(false);
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    assertStaleResponse(restoredQuick, opponentQuick!);

    const result = applyAndAssert(restored, pass!);

    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "attackNegationResponse", responsePlayer: 1 } });
    expect(restored.state.chain).toHaveLength(0);
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passAttack", player: 1, windowKind: "battle" })]));
    expect(result.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-battle-opponent-chain-quick")).toBe(false);
    expect(hasGroupedEffect(result.legalActionGroups, 1, "restore-battle-opponent-chain-quick", "battle")).toBe(false);
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
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 1), 1)).toBe(true);
    const opponentQuick = getDuelLegalActions(restoredQuick, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-damage-opponent-chain-quick");
    expect(opponentQuick).toBeDefined();
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredQuick, 1), 1, "restore-damage-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    const quickResult = applyAndAssert(restoredQuick, opponentQuick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "startDamageStep", responsePlayer: 1 } });
    expect(restoredQuick.state.chain).toHaveLength(0);
    expect(restoredQuick.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored damage turn quick resolved")).toBe(true);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored damage opponent chain quick resolved")).toBe(true);
    expect(quickResult.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(quickResult.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-damage-opponent-chain-quick")).toBe(false);
    expect(hasGroupedEffect(quickResult.legalActionGroups, 1, "restore-damage-opponent-chain-quick", "battle")).toBe(false);
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    assertStaleResponse(restoredQuick, opponentQuick!);

    const result = applyAndAssert(restored, pass!);

    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "startDamageStep", responsePlayer: 1 } });
    expect(restored.state.chain).toHaveLength(0);
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(result.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-damage-opponent-chain-quick")).toBe(false);
    expect(hasGroupedEffect(result.legalActionGroups, 1, "restore-damage-opponent-chain-quick", "battle")).toBe(false);
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
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 1), 1)).toBe(true);
    const opponentQuick = getDuelLegalActions(restoredQuick, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-damage-calc-opponent-chain-quick");
    expect(opponentQuick).toBeDefined();
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredQuick, 1), 1, "restore-damage-calc-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    const quickResult = applyAndAssert(restoredQuick, opponentQuick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 1 } });
    expect(restoredQuick.state.chain).toHaveLength(0);
    expect(restoredQuick.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored damage calculation turn quick resolved")).toBe(true);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored damage calculation opponent chain quick resolved")).toBe(true);
    expect(quickResult.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(quickResult.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-damage-calc-opponent-chain-quick")).toBe(false);
    expect(hasGroupedEffect(quickResult.legalActionGroups, 1, "restore-damage-calc-opponent-chain-quick", "battle")).toBe(false);
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    assertStaleResponse(restoredQuick, opponentQuick!);

    const result = applyAndAssert(restored, pass!);

    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 1 } });
    expect(restored.state.chain).toHaveLength(0);
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(result.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-damage-calc-opponent-chain-quick")).toBe(false);
    expect(hasGroupedEffect(result.legalActionGroups, 1, "restore-damage-calc-opponent-chain-quick", "battle")).toBe(false);
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    assertStaleResponse(restored, pass!);
  });

  it("returns restored after-damage quick chains to the after-damage response player", () => {
    const session = createBattleSession(["100", "300"], ["400", "500"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnQuickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(turnQuickSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    registerEffect(session, damageStepQuickEffect("restore-after-damage-turn-quick", turnQuickSource!.uid, 0, "Restored after damage turn quick resolved"));
    registerEffect(session, chainOnlyDamageStepQuickEffect("restore-after-damage-opponent-chain-quick", opponentQuickSource!.uid, 1, "Restored after damage opponent chain quick resolved"));
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    passBattleWindow(session, "passAttack");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    expect(session.state.battleWindow).toMatchObject({ kind: "afterDamageCalculation", responsePlayer: 1 });
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-after-damage-turn-quick");
    expect(quick).toBeDefined();
    expect(applyAndAssert(session, quick!).state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-after-damage-turn-quick": restoreDamageStepQuickEffect("Restored after damage turn quick resolved"),
      "restore-after-damage-opponent-chain-quick": restoreChainOnlyDamageStepQuickEffect("Restored after damage opponent chain quick resolved"),
    });
    const restoredQuick = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-after-damage-turn-quick": restoreDamageStepQuickEffect("Restored after damage turn quick resolved"),
      "restore-after-damage-opponent-chain-quick": restoreChainOnlyDamageStepQuickEffect("Restored after damage opponent chain quick resolved"),
    });
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 1), 1)).toBe(true);
    const opponentQuick = getDuelLegalActions(restoredQuick, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-after-damage-opponent-chain-quick");
    expect(opponentQuick).toBeDefined();
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredQuick, 1), 1, "restore-after-damage-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    const quickResult = applyAndAssert(restoredQuick, opponentQuick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "afterDamageCalculation", responsePlayer: 1 } });
    expect(restoredQuick.state.chain).toHaveLength(0);
    expect(restoredQuick.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored after damage turn quick resolved")).toBe(true);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored after damage opponent chain quick resolved")).toBe(true);
    expect(quickResult.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(quickResult.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-after-damage-opponent-chain-quick")).toBe(false);
    expect(hasGroupedEffect(quickResult.legalActionGroups, 1, "restore-after-damage-opponent-chain-quick", "battle")).toBe(false);
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    assertStaleResponse(restoredQuick, opponentQuick!);

    const result = applyAndAssert(restored, pass!);

    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "afterDamageCalculation", responsePlayer: 1 } });
    expect(restored.state.chain).toHaveLength(0);
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(result.state.log.some((entry) => entry.detail === "Restored after damage turn quick resolved")).toBe(true);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(result.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-after-damage-opponent-chain-quick")).toBe(false);
    expect(hasGroupedEffect(result.legalActionGroups, 1, "restore-after-damage-opponent-chain-quick", "battle")).toBe(false);
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    assertStaleResponse(restored, pass!);
  });

  it("returns restored end-damage quick chains to the end-damage response player", () => {
    const session = createBattleSession(["100", "300"], ["400", "500"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnQuickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(turnQuickSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    registerEffect(session, damageStepQuickEffect("restore-end-damage-turn-quick", turnQuickSource!.uid, 0, "Restored end damage turn quick resolved"));
    registerEffect(session, chainOnlyDamageStepQuickEffect("restore-end-damage-opponent-chain-quick", opponentQuickSource!.uid, 1, "Restored end damage opponent chain quick resolved"));
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    passBattleWindow(session, "passAttack");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    passBattleWindow(session, "passDamage");
    expect(session.state.battleWindow).toMatchObject({ kind: "endDamageStep", responsePlayer: 1 });
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-end-damage-turn-quick");
    expect(quick).toBeDefined();
    expect(applyAndAssert(session, quick!).state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-end-damage-turn-quick": restoreDamageStepQuickEffect("Restored end damage turn quick resolved"),
      "restore-end-damage-opponent-chain-quick": restoreChainOnlyDamageStepQuickEffect("Restored end damage opponent chain quick resolved"),
    });
    const restoredQuick = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-end-damage-turn-quick": restoreDamageStepQuickEffect("Restored end damage turn quick resolved"),
      "restore-end-damage-opponent-chain-quick": restoreChainOnlyDamageStepQuickEffect("Restored end damage opponent chain quick resolved"),
    });
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 1), 1)).toBe(true);
    const opponentQuick = getDuelLegalActions(restoredQuick, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-end-damage-opponent-chain-quick");
    expect(opponentQuick).toBeDefined();
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredQuick, 1), 1, "restore-end-damage-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    const quickResult = applyAndAssert(restoredQuick, opponentQuick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "endDamageStep", responsePlayer: 1 } });
    expect(restoredQuick.state.chain).toHaveLength(0);
    expect(restoredQuick.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored end damage turn quick resolved")).toBe(true);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored end damage opponent chain quick resolved")).toBe(true);
    expect(quickResult.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(quickResult.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-end-damage-opponent-chain-quick")).toBe(false);
    expect(hasGroupedEffect(quickResult.legalActionGroups, 1, "restore-end-damage-opponent-chain-quick", "battle")).toBe(false);
    expect(getDuelLegalActions(restoredQuick, 0)).toEqual([]);
    assertStaleResponse(restoredQuick, opponentQuick!);

    const result = applyAndAssert(restored, pass!);

    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "endDamageStep", responsePlayer: 1 } });
    expect(restored.state.chain).toHaveLength(0);
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(result.state.log.some((entry) => entry.detail === "Restored end damage turn quick resolved")).toBe(true);
    expect(result.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "passDamage", player: 1, windowKind: "battle" })]));
    expect(result.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-end-damage-opponent-chain-quick")).toBe(false);
    expect(hasGroupedEffect(result.legalActionGroups, 1, "restore-end-damage-opponent-chain-quick", "battle")).toBe(false);
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
    if (!pass) return;
    applyAndAssert(session, pass!);
  }
}

function advanceToEndDamageStep(session: ReturnType<typeof createDuel>): void {
  for (let count = 0; count < 20; count += 1) {
    if (session.state.battleWindow?.kind === "endDamageStep" && session.state.battleWindow.responsePlayer === 1) return;
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((action) => action.type === "passDamage");
    if (!pass) break;
    applyAndAssert(session, pass);
  }
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  assertLegalWindow(session, response, response.state.waitingFor!);
  return response;
}

function assertStaleResponse(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const stale = applyResponse(session, action);
  expect(stale.ok).toBe(false);
  expect(stale.error).toContain("Response is not currently legal");
  assertLegalWindow(session, stale, stale.state.waitingFor!);
}

function assertLegalWindow(session: ReturnType<typeof createDuel>, response: ReturnType<typeof applyResponse>, player: 0 | 1): void {
  const windowId = session.state.actionWindowId;
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}

function hasGroupedEffect(
  groups: ReturnType<typeof getGroupedDuelLegalActions>,
  player: 0 | 1,
  effectId: string,
  windowKind: "battle" | "chainResponse",
): boolean {
  return groups.some(
    (group) =>
      group.windowKind === windowKind &&
      group.actions.some(
        (action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowKind === windowKind,
      ),
  );
}

function hasGroupedPass(groups: ReturnType<typeof getGroupedDuelLegalActions>, player: 0 | 1): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "chainResponse" &&
      group.actions.some((action) => action.type === "passChain" && action.player === player && action.windowId === group.windowId && action.windowKind === "chainResponse"),
  );
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

function battleDamageTrigger(id: string, sourceUid: string, detail: string): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller: 0,
    event: "trigger",
    triggerEvent: "battleDamageDealt",
    range: ["hand"],
    operation(ctx) {
      ctx.log(detail);
    },
  };
}

function beforeBattleDamageTrigger(id: string, sourceUid: string, detail: string): DuelEffectDefinition {
  return {
    ...battleDamageTrigger(id, sourceUid, detail),
    triggerEvent: "beforeBattleDamage",
  };
}

function restoreBattleDamageTrigger(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...effect,
    operation(ctx) {
      ctx.log(detail);
    },
  });
}

function restoreBeforeBattleDamageTrigger(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreBattleDamageTrigger(detail)(effect),
    triggerEvent: "beforeBattleDamage",
  });
}

function battleCleanupTriggerRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-before-battle-damage-bucket-trigger": restoreBeforeBattleDamageTrigger("Restored before battle damage bucket trigger resolved"),
    "restore-battle-damage-bucket-trigger": restoreBattleDamageTrigger("Restored battle damage bucket trigger resolved"),
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
