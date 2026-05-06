import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("battle declaration restore", () => {
  it("restores direct attack declarations to opponent battle fast-effect priority", () => {
    const session = createDuel({ seed: 254, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnQuick = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuick = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(turnQuick).toBeTruthy();
    expect(opponentQuick).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    registerEffect(session, battleQuickEffect("restore-attack-declare-turn-quick", turnQuick!.uid, 0));
    registerEffect(session, battleQuickEffect("restore-attack-declare-opponent-quick", opponentQuick!.uid, 1));

    const battlePhase = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase).toBeDefined();
    expect(applyResponse(session, battlePhase!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.directAttack);
    expect(attack).toBeDefined();
    const result = applyResponse(session, attack!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "attackNegationResponse", responsePlayer: 1 } });
    expect(result.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-attack-declare-opponent-quick")).toBe(true);
    expect(getDuelLegalActions(session, 0)).toEqual([]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-attack-declare-turn-quick": restoreBattleQuickEffect,
      "restore-attack-declare-opponent-quick": restoreBattleQuickEffect,
    });
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "attackNegationResponse", responsePlayer: 1 } });
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid });
    expect(restored.state.currentAttack?.targetUid).toBeUndefined();
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual([]);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.effectId === "restore-attack-declare-opponent-quick")).toBe(true);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.effectId === "restore-attack-declare-turn-quick")).toBe(false);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "passAttack")).toBe(true);
    expect(getGroupedDuelLegalActions(restored, 1).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 1));

    const staleAttack = applyResponse(restored, attack!);
    expect(staleAttack.ok).toBe(false);
    expect(staleAttack.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleAttack, 1);
  });

  it("restores targeted attack declarations to opponent battle fast-effect priority", () => {
    const session = createDuel({ seed: 255, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnQuick = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    const opponentQuick = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "500");
    expect(attacker).toBeTruthy();
    expect(turnQuick).toBeTruthy();
    expect(target).toBeTruthy();
    expect(opponentQuick).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    registerEffect(session, battleQuickEffect("restore-targeted-attack-turn-quick", turnQuick!.uid, 0));
    registerEffect(session, battleQuickEffect("restore-targeted-attack-opponent-quick", opponentQuick!.uid, 1));

    const battlePhase = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase).toBeDefined();
    expect(applyResponse(session, battlePhase!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    const result = applyResponse(session, attack!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "attackNegationResponse", responsePlayer: 1 } });
    expect(result.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-targeted-attack-opponent-quick")).toBe(true);
    expect(getDuelLegalActions(session, 0)).toEqual([]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-targeted-attack-turn-quick": restoreBattleQuickEffect,
      "restore-targeted-attack-opponent-quick": restoreBattleQuickEffect,
    });
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 1, windowKind: "battle", battleWindow: { kind: "attackNegationResponse", responsePlayer: 1 } });
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack" });
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual([]);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.effectId === "restore-targeted-attack-opponent-quick")).toBe(true);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "activateEffect" && action.effectId === "restore-targeted-attack-turn-quick")).toBe(false);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "passAttack")).toBe(true);
    expect(getGroupedDuelLegalActions(restored, 1).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 1));

    const staleAttack = applyResponse(restored, attack!);
    expect(staleAttack.ok).toBe(false);
    expect(staleAttack.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleAttack, 1);
  });

  it("restores targeted attack response passes without losing the target", () => {
    const session = createDuel({ seed: 256, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    const battlePhase = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase).toBeDefined();
    expect(applyResponse(session, battlePhase!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    expect(applyResponse(session, attack!).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.battleWindow).toMatchObject({ kind: "attackNegationResponse", responsePlayer: 1 });
    const opponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passAttack");
    expect(opponentPass).toBeDefined();

    const stalePass = applyResponse(restored, { ...opponentPass!, windowId: opponentPass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 1);

    const passResult = applyResponse(restored, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(passResult.state).toMatchObject({ waitingFor: 0, windowKind: "battle", attackPasses: [1], battleWindow: { kind: "attackNegationResponse", responsePlayer: 0 } });
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "passAttack")).toBe(true);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    assertLegalWindow(restored, passResult, 0);

    const staleReplay = applyResponse(restored, opponentPass!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleReplay, 0);
  });

  it("restores targeted attack turn passes into damage step without losing the target", () => {
    const session = createDuel({ seed: 257, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    const battlePhase = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase).toBeDefined();
    expect(applyResponse(session, battlePhase!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    expect(applyResponse(session, attack!).ok).toBe(true);
    const opponentPass = getDuelLegalActions(session, 1).find((action) => action.type === "passAttack");
    expect(opponentPass).toBeDefined();
    expect(applyResponse(session, opponentPass!).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.attackPasses).toEqual([1]);
    expect(restored.state.battleWindow).toMatchObject({ kind: "attackNegationResponse", responsePlayer: 0 });
    const turnPass = getDuelLegalActions(restored, 0).find((action) => action.type === "passAttack");
    expect(turnPass).toBeDefined();

    const stalePass = applyResponse(restored, { ...turnPass!, windowId: turnPass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 0);

    const passResult = applyResponse(restored, turnPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(passResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", attackPasses: [], damagePasses: [], battleWindow: { kind: "startDamageStep", responsePlayer: 1 } });
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "passDamage")).toBe(true);
    expect(getGroupedDuelLegalActions(restored, 1).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 1));
    assertLegalWindow(restored, passResult, 1);

    const staleReplay = applyResponse(restored, turnPass!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleReplay, 1);
  });

  it("restores targeted start-damage passes without losing the target", () => {
    const session = createDuel({ seed: 258, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";

    const battlePhase = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase).toBeDefined();
    expect(applyResponse(session, battlePhase!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    expect(applyResponse(session, attack!).ok).toBe(true);
    const opponentAttackPass = getDuelLegalActions(session, 1).find((action) => action.type === "passAttack");
    expect(opponentAttackPass).toBeDefined();
    expect(applyResponse(session, opponentAttackPass!).ok).toBe(true);
    const turnAttackPass = getDuelLegalActions(session, 0).find((action) => action.type === "passAttack");
    expect(turnAttackPass).toBeDefined();
    expect(applyResponse(session, turnAttackPass!).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.battleWindow).toMatchObject({ kind: "startDamageStep", responsePlayer: 1 });
    const opponentDamagePass = getDuelLegalActions(restored, 1).find((action) => action.type === "passDamage");
    expect(opponentDamagePass).toBeDefined();

    const stalePass = applyResponse(restored, { ...opponentDamagePass!, windowId: opponentDamagePass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 1);

    const passResult = applyResponse(restored, opponentDamagePass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(passResult.state).toMatchObject({ waitingFor: 0, windowKind: "battle", damagePasses: [1], battleWindow: { kind: "startDamageStep", responsePlayer: 0 } });
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "passDamage")).toBe(true);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    assertLegalWindow(restored, passResult, 0);

    const staleReplay = applyResponse(restored, opponentDamagePass!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleReplay, 0);
  });
});

function battleQuickEffect(id: string, sourceUid: string, controller: 0 | 1): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "quick",
    range: ["hand"],
    operation(ctx) {
      ctx.log(`${id} resolved`);
    },
  };
}

function restoreBattleQuickEffect(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...effect,
    operation(ctx) {
      ctx.log(`${effect.id} resolved`);
    },
  };
}

function assertLegalWindow(session: ReturnType<typeof restoreDuel>, response: ReturnType<typeof applyResponse>, player: 0 | 1): void {
  const windowId = session.state.actionWindowId;
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}
