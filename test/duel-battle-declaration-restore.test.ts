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
    const opponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passAttack");
    const turnQuickEffect = restored.state.effects.find((effect) => effect.sourceUid === turnQuick!.uid);
    expect(opponentPass).toBeDefined();
    expect(turnQuickEffect).toBeDefined();
    expect(opponentPass!.windowToken).toBeDefined();

    const forgedTurnQuick = applyResponse(restored, {
      type: "activateEffect",
      player: 1,
      uid: turnQuick!.uid,
      effectId: turnQuickEffect!.id,
      label: "Forge turn quick into restored opponent attack response",
      windowId: opponentPass!.windowId!,
      windowKind: opponentPass!.windowKind!,
      windowToken: opponentPass!.windowToken!,
    });
    expect(forgedTurnQuick.ok).toBe(false);
    expect(forgedTurnQuick.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, forgedTurnQuick, 1);
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(restored.state.log.some((entry) => entry.detail === "restore-attack-declare-turn-quick resolved")).toBe(false);

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
    const opponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passAttack");
    const turnQuickEffect = restored.state.effects.find((effect) => effect.sourceUid === turnQuick!.uid);
    expect(opponentPass).toBeDefined();
    expect(turnQuickEffect).toBeDefined();
    expect(opponentPass!.windowToken).toBeDefined();

    const forgedTurnQuick = applyResponse(restored, {
      type: "activateEffect",
      player: 1,
      uid: turnQuick!.uid,
      effectId: turnQuickEffect!.id,
      label: "Forge turn quick into restored targeted attack response",
      windowId: opponentPass!.windowId!,
      windowKind: opponentPass!.windowKind!,
      windowToken: opponentPass!.windowToken!,
    });
    expect(forgedTurnQuick.ok).toBe(false);
    expect(forgedTurnQuick.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, forgedTurnQuick, 1);
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack" });
    expect(restored.state.log.some((entry) => entry.detail === "restore-targeted-attack-turn-quick resolved")).toBe(false);

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
    expect(opponentPass!.windowToken).toBeDefined();

    const stalePass = applyResponse(restored, { ...opponentPass!, windowId: opponentPass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 1);
    const forgedDamagePass = applyResponse(restored, {
      type: "passDamage",
      player: 1,
      label: "Forge damage pass into restored targeted attack response",
      windowId: opponentPass!.windowId!,
      windowKind: opponentPass!.windowKind!,
      windowToken: opponentPass!.windowToken!,
    });
    expect(forgedDamagePass.ok).toBe(false);
    expect(forgedDamagePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, forgedDamagePass, 1);
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack" });

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
    expect(turnPass!.windowToken).toBeDefined();

    const stalePass = applyResponse(restored, { ...turnPass!, windowId: turnPass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 0);
    const forgedDamagePass = applyResponse(restored, {
      type: "passDamage",
      player: 0,
      label: "Forge damage pass into restored turn attack response",
      windowId: turnPass!.windowId!,
      windowKind: turnPass!.windowKind!,
      windowToken: turnPass!.windowToken!,
    });
    expect(forgedDamagePass.ok).toBe(false);
    expect(forgedDamagePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, forgedDamagePass, 0);
    expect(restored.state.attackPasses).toEqual([1]);
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack" });

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

  it("restores targeted turn start-damage passes into before-damage calculation", () => {
    const session = createDuel({ seed: 259, startingHandSize: 2, cardReader: createCardReader(cards) });
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
    const opponentDamagePass = getDuelLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentDamagePass).toBeDefined();
    expect(applyResponse(session, opponentDamagePass!).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.damagePasses).toEqual([1]);
    expect(restored.state.battleWindow).toMatchObject({ kind: "startDamageStep", responsePlayer: 0 });
    const turnDamagePass = getDuelLegalActions(restored, 0).find((action) => action.type === "passDamage");
    expect(turnDamagePass).toBeDefined();

    const stalePass = applyResponse(restored, { ...turnDamagePass!, windowId: turnDamagePass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 0);

    const passResult = applyResponse(restored, turnDamagePass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(passResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleWindow: { kind: "beforeDamageCalculation", responsePlayer: 1 } });
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "passDamage")).toBe(true);
    expect(getGroupedDuelLegalActions(restored, 1).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 1));
    assertLegalWindow(restored, passResult, 1);

    const staleReplay = applyResponse(restored, turnDamagePass!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleReplay, 1);
  });

  it("restores targeted before-damage passes into damage calculation", () => {
    const session = createDuel({ seed: 260, startingHandSize: 2, cardReader: createCardReader(cards) });
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
    const opponentStartDamagePass = getDuelLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentStartDamagePass).toBeDefined();
    expect(applyResponse(session, opponentStartDamagePass!).ok).toBe(true);
    const turnStartDamagePass = getDuelLegalActions(session, 0).find((action) => action.type === "passDamage");
    expect(turnStartDamagePass).toBeDefined();
    expect(applyResponse(session, turnStartDamagePass!).ok).toBe(true);
    const opponentBeforeDamagePass = getDuelLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentBeforeDamagePass).toBeDefined();
    expect(applyResponse(session, opponentBeforeDamagePass!).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.damagePasses).toEqual([1]);
    expect(restored.state.battleWindow).toMatchObject({ kind: "beforeDamageCalculation", responsePlayer: 0 });
    const turnBeforeDamagePass = getDuelLegalActions(restored, 0).find((action) => action.type === "passDamage");
    expect(turnBeforeDamagePass).toBeDefined();

    const stalePass = applyResponse(restored, { ...turnBeforeDamagePass!, windowId: turnBeforeDamagePass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 0);

    const passResult = applyResponse(restored, turnBeforeDamagePass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(passResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleStep: "damageCalculation", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 1 } });
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "passDamage")).toBe(true);
    expect(getGroupedDuelLegalActions(restored, 1).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 1));
    assertLegalWindow(restored, passResult, 1);

    const staleReplay = applyResponse(restored, turnBeforeDamagePass!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleReplay, 1);
  });

  it("restores targeted damage-calculation passes without losing the target", () => {
    const session = createDuel({ seed: 261, startingHandSize: 2, cardReader: createCardReader(cards) });
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
    const opponentStartDamagePass = getDuelLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentStartDamagePass).toBeDefined();
    expect(applyResponse(session, opponentStartDamagePass!).ok).toBe(true);
    const turnStartDamagePass = getDuelLegalActions(session, 0).find((action) => action.type === "passDamage");
    expect(turnStartDamagePass).toBeDefined();
    expect(applyResponse(session, turnStartDamagePass!).ok).toBe(true);
    const opponentBeforeDamagePass = getDuelLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentBeforeDamagePass).toBeDefined();
    expect(applyResponse(session, opponentBeforeDamagePass!).ok).toBe(true);
    const turnBeforeDamagePass = getDuelLegalActions(session, 0).find((action) => action.type === "passDamage");
    expect(turnBeforeDamagePass).toBeDefined();
    expect(applyResponse(session, turnBeforeDamagePass!).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.damagePasses).toEqual([]);
    expect(restored.state.battleStep).toBe("damageCalculation");
    expect(restored.state.battleWindow).toMatchObject({ kind: "duringDamageCalculation", responsePlayer: 1 });
    const opponentDamageCalcPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passDamage");
    expect(opponentDamageCalcPass).toBeDefined();

    const stalePass = applyResponse(restored, { ...opponentDamageCalcPass!, windowId: opponentDamageCalcPass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 1);

    const passResult = applyResponse(restored, opponentDamageCalcPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(passResult.state).toMatchObject({ waitingFor: 0, windowKind: "battle", damagePasses: [1], battleStep: "damageCalculation", battleWindow: { kind: "duringDamageCalculation", responsePlayer: 0 } });
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "passDamage")).toBe(true);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    assertLegalWindow(restored, passResult, 0);

    const staleReplay = applyResponse(restored, opponentDamageCalcPass!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleReplay, 0);
  });

  it("restores targeted turn damage-calculation passes into after-damage calculation", () => {
    const session = createDuel({ seed: 262, startingHandSize: 2, cardReader: createCardReader(cards) });
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
    const opponentStartDamagePass = getDuelLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentStartDamagePass).toBeDefined();
    expect(applyResponse(session, opponentStartDamagePass!).ok).toBe(true);
    const turnStartDamagePass = getDuelLegalActions(session, 0).find((action) => action.type === "passDamage");
    expect(turnStartDamagePass).toBeDefined();
    expect(applyResponse(session, turnStartDamagePass!).ok).toBe(true);
    const opponentBeforeDamagePass = getDuelLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentBeforeDamagePass).toBeDefined();
    expect(applyResponse(session, opponentBeforeDamagePass!).ok).toBe(true);
    const turnBeforeDamagePass = getDuelLegalActions(session, 0).find((action) => action.type === "passDamage");
    expect(turnBeforeDamagePass).toBeDefined();
    expect(applyResponse(session, turnBeforeDamagePass!).ok).toBe(true);
    const opponentDamageCalcPass = getDuelLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentDamageCalcPass).toBeDefined();
    expect(applyResponse(session, opponentDamageCalcPass!).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.damagePasses).toEqual([1]);
    expect(restored.state.battleStep).toBe("damageCalculation");
    expect(restored.state.battleWindow).toMatchObject({ kind: "duringDamageCalculation", responsePlayer: 0 });
    const turnDamageCalcPass = getDuelLegalActions(restored, 0).find((action) => action.type === "passDamage");
    expect(turnDamageCalcPass).toBeDefined();

    const stalePass = applyResponse(restored, { ...turnDamageCalcPass!, windowId: turnDamageCalcPass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 0);

    const passResult = applyResponse(restored, turnDamageCalcPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(passResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleStep: "damage", battleWindow: { kind: "afterDamageCalculation", responsePlayer: 1 } });
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "passDamage")).toBe(true);
    expect(getGroupedDuelLegalActions(restored, 1).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 1));
    assertLegalWindow(restored, passResult, 1);

    const staleReplay = applyResponse(restored, turnDamageCalcPass!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleReplay, 1);
  });

  it("restores targeted after-damage passes without losing the target", () => {
    const session = createDuel({ seed: 263, startingHandSize: 2, cardReader: createCardReader(cards) });
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
    passDamageProgressionToAfterDamageCalculation(session);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.damagePasses).toEqual([]);
    expect(restored.state.battleStep).toBe("damage");
    expect(restored.state.battleWindow).toMatchObject({ kind: "afterDamageCalculation", responsePlayer: 1 });
    const opponentAfterDamagePass = getDuelLegalActions(restored, 1).find((action) => action.type === "passDamage");
    expect(opponentAfterDamagePass).toBeDefined();

    const stalePass = applyResponse(restored, { ...opponentAfterDamagePass!, windowId: opponentAfterDamagePass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 1);

    const passResult = applyResponse(restored, opponentAfterDamagePass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(passResult.state).toMatchObject({ waitingFor: 0, windowKind: "battle", damagePasses: [1], battleStep: "damage", battleWindow: { kind: "afterDamageCalculation", responsePlayer: 0 } });
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "passDamage")).toBe(true);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    assertLegalWindow(restored, passResult, 0);

    const staleReplay = applyResponse(restored, opponentAfterDamagePass!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleReplay, 0);
  });

  it("restores targeted turn after-damage passes into end damage step", () => {
    const session = createDuel({ seed: 264, startingHandSize: 2, cardReader: createCardReader(cards) });
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
    passDamageProgressionToAfterDamageCalculation(session);
    const opponentAfterDamagePass = getDuelLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentAfterDamagePass).toBeDefined();
    expect(applyResponse(session, opponentAfterDamagePass!).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.damagePasses).toEqual([1]);
    expect(restored.state.battleStep).toBe("damage");
    expect(restored.state.battleWindow).toMatchObject({ kind: "afterDamageCalculation", responsePlayer: 0 });
    const turnAfterDamagePass = getDuelLegalActions(restored, 0).find((action) => action.type === "passDamage");
    expect(turnAfterDamagePass).toBeDefined();

    const stalePass = applyResponse(restored, { ...turnAfterDamagePass!, windowId: turnAfterDamagePass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 0);

    const passResult = applyResponse(restored, turnAfterDamagePass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(passResult.state).toMatchObject({ waitingFor: 1, windowKind: "battle", damagePasses: [], battleStep: "damage", battleWindow: { kind: "endDamageStep", responsePlayer: 1 } });
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "passDamage")).toBe(true);
    expect(getGroupedDuelLegalActions(restored, 1).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 1));
    assertLegalWindow(restored, passResult, 1);

    const staleReplay = applyResponse(restored, turnAfterDamagePass!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleReplay, 1);
  });

  it("restores targeted end-damage passes without losing the target", () => {
    const session = createDuel({ seed: 265, startingHandSize: 2, cardReader: createCardReader(cards) });
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
    passDamageProgressionToAfterDamageCalculation(session);
    const opponentAfterDamagePass = getDuelLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentAfterDamagePass).toBeDefined();
    expect(applyResponse(session, opponentAfterDamagePass!).ok).toBe(true);
    const turnAfterDamagePass = getDuelLegalActions(session, 0).find((action) => action.type === "passDamage");
    expect(turnAfterDamagePass).toBeDefined();
    expect(applyResponse(session, turnAfterDamagePass!).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.damagePasses).toEqual([]);
    expect(restored.state.battleStep).toBe("damage");
    expect(restored.state.battleWindow).toMatchObject({ kind: "endDamageStep", responsePlayer: 1 });
    const opponentEndDamagePass = getDuelLegalActions(restored, 1).find((action) => action.type === "passDamage");
    expect(opponentEndDamagePass).toBeDefined();

    const stalePass = applyResponse(restored, { ...opponentEndDamagePass!, windowId: opponentEndDamagePass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 1);

    const passResult = applyResponse(restored, opponentEndDamagePass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(passResult.state).toMatchObject({ waitingFor: 0, windowKind: "battle", damagePasses: [1], battleStep: "damage", battleWindow: { kind: "endDamageStep", responsePlayer: 0 } });
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "passDamage")).toBe(true);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    assertLegalWindow(restored, passResult, 0);

    const staleReplay = applyResponse(restored, opponentEndDamagePass!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleReplay, 0);
  });

  it("restores targeted turn end-damage passes through battle cleanup", () => {
    const session = createDuel({ seed: 266, startingHandSize: 2, cardReader: createCardReader(cards) });
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
    passDamageProgressionToAfterDamageCalculation(session);
    const opponentAfterDamagePass = getDuelLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentAfterDamagePass).toBeDefined();
    expect(applyResponse(session, opponentAfterDamagePass!).ok).toBe(true);
    const turnAfterDamagePass = getDuelLegalActions(session, 0).find((action) => action.type === "passDamage");
    expect(turnAfterDamagePass).toBeDefined();
    expect(applyResponse(session, turnAfterDamagePass!).ok).toBe(true);
    const opponentEndDamagePass = getDuelLegalActions(session, 1).find((action) => action.type === "passDamage");
    expect(opponentEndDamagePass).toBeDefined();
    expect(applyResponse(session, opponentEndDamagePass!).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.damagePasses).toEqual([1]);
    expect(restored.state.battleStep).toBe("damage");
    expect(restored.state.battleWindow).toMatchObject({ kind: "endDamageStep", responsePlayer: 0 });
    const turnEndDamagePass = getDuelLegalActions(restored, 0).find((action) => action.type === "passDamage");
    expect(turnEndDamagePass).toBeDefined();

    const stalePass = applyResponse(restored, { ...turnEndDamagePass!, windowId: turnEndDamagePass!.windowId! - 1 });
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, stalePass, 0);

    const passResult = applyResponse(restored, turnEndDamagePass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(passResult.state).toMatchObject({ waitingFor: 0, windowKind: "open", damagePasses: [], players: { 1: { lifePoints: 7700 } } });
    expect(passResult.state.battleWindow).toBeUndefined();
    expect(restored.state.currentAttack).toBeUndefined();
    expect(restored.state.pendingBattle).toBeUndefined();
    expect(restored.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    assertLegalWindow(restored, passResult, 0);

    const staleReplay = applyResponse(restored, turnEndDamagePass!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    assertLegalWindow(restored, staleReplay, 0);
  });
});

function passDamageProgressionToAfterDamageCalculation(session: ReturnType<typeof createDuel>): void {
  const sequence = [
    { player: 1, type: "passAttack" },
    { player: 0, type: "passAttack" },
    { player: 1, type: "passDamage" },
    { player: 0, type: "passDamage" },
    { player: 1, type: "passDamage" },
    { player: 0, type: "passDamage" },
    { player: 1, type: "passDamage" },
    { player: 0, type: "passDamage" },
  ] as const;
  for (const step of sequence) {
    const pass = getDuelLegalActions(session, step.player).find((action) => action.type === step.type);
    expect(pass).toBeDefined();
    expect(applyResponse(session, pass!).ok).toBe(true);
  }
}

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
