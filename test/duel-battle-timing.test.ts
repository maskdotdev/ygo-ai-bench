import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, negateDuelAttack, queryPublicState, registerEffect, restoreDuel, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel battle timing", () => {
  it("restores an active damage-step battle window and can continue resolving battle", () => {
    const session = createDuel({ seed: 53, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passAttack")!);
    expect(session.state.battleWindow).toMatchObject({ kind: "startDamageStep", attackerUid: attacker!.uid, responsePlayer: 1 });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.battleWindow).toEqual(session.state.battleWindow);
    expect(restored.state.pendingBattle).toEqual(session.state.pendingBattle);
    const staleRestoredPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passDamage");
    expect(staleRestoredPass).toMatchObject({
      windowId: restored.state.actionWindowId,
      windowKind: "battle",
    });
    expect(staleRestoredPass!.windowToken).toBeDefined();
    expect(groupedActionSummary(restored, 1)).toEqual([
      { label: "Pass", windowId: queryPublicState(restored).actionWindowId, windowKind: "battle", actionTypes: ["passDamage"] },
    ]);
    const forgedAttackPass = applyResponse(restored, {
      type: "passAttack",
      player: 1,
      label: "Forge attack response into restored damage window",
      windowId: staleRestoredPass!.windowId!,
      windowKind: staleRestoredPass!.windowKind!,
      windowToken: staleRestoredPass!.windowToken!,
    });
    expect(forgedAttackPass.ok).toBe(false);
    expect(forgedAttackPass.error).toContain("Response is not currently legal");
    expect(forgedAttackPass.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(forgedAttackPass.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(forgedAttackPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(restored.state.battleWindow).toEqual(session.state.battleWindow);
    expect(restored.state.pendingBattle).toEqual(session.state.pendingBattle);
    applyAndAssert(restored, staleRestoredPass!);
    const replay = applyResponse(restored, staleRestoredPass!);
    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.state.actionWindowId).toBe(restored.state.actionWindowId);

    while (restored.state.battleWindow) {
      const player = restored.state.battleWindow.responsePlayer;
      const pass = getDuelLegalActions(restored, player).find((action) => action.type === "passDamage");
      expect(pass).toBeTruthy();
      applyAndAssert(restored, pass!);
    }
    expect(restored.state.players[1].lifePoints).toBe(6200);
    expect(restored.state.pendingBattle).toBeUndefined();
  });

  it("restores a replay decision window with legal replay and cancel actions intact", () => {
    const session = createDuel({ seed: 54, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    const remover = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    expect(remover).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    specialSummonDuelCard(session.state, target!.uid, 1);
    registerEffect(session, {
      id: "remove-target-before-replay-restore",
      sourceUid: remover!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(target!.uid, "graveyard", 1);
      },
    });

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "remove-target-before-replay-restore")!);
    expect(passCurrentChainIfPending(session)).toBe(true);
    while (session.state.battleWindow?.kind !== "replayDecision") {
      const player = session.state.battleWindow!.responsePlayer;
      const pass = getDuelLegalActions(session, player).find((action) => action.type === (session.state.battleWindow!.step === "attack" ? "passAttack" : "passDamage"));
      expect(pass).toBeTruthy();
      applyAndAssert(session, pass!);
    }

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.battleWindow).toEqual(session.state.battleWindow);
    expect(restored.state.pendingBattle).toEqual(session.state.pendingBattle);
    const replayActions = getDuelLegalActions(restored, 0);
    const cancelAction = replayActions.find((action) => action.type === "cancelAttack" && action.attackerUid === attacker!.uid);
    const directReplay = replayActions.find((action) => action.type === "replayAttack" && action.attackerUid === attacker!.uid && action.targetUid === undefined);
    expect(cancelAction).toBeTruthy();
    expect(directReplay).toBeTruthy();
    expect(directReplay!.windowToken).toBeDefined();
    expect(groupedActionSummary(restored, 0)).toEqual([
      { label: "Attacks", windowId: queryPublicState(restored).actionWindowId, windowKind: "battle", actionTypes: ["cancelAttack", "replayAttack"] },
    ]);

    const forgedRemovedTargetReplay = applyResponse(restored, {
      type: "replayAttack",
      player: 0,
      attackerUid: attacker!.uid,
      targetUid: target!.uid,
      label: "Forge removed target replay into restored replay window",
      windowId: directReplay!.windowId!,
      windowKind: directReplay!.windowKind!,
      windowToken: directReplay!.windowToken!,
    });
    expect(forgedRemovedTargetReplay.ok).toBe(false);
    expect(forgedRemovedTargetReplay.error).toContain("Response is not currently legal");
    expect(forgedRemovedTargetReplay.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(forgedRemovedTargetReplay.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(forgedRemovedTargetReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(restored.state.battleWindow).toEqual(session.state.battleWindow);
    expect(restored.state.pendingBattle).toEqual(session.state.pendingBattle);

    applyAndAssert(restored, cancelAction!);
    expect(restored.state.pendingBattle).toBeUndefined();
    expect(restored.state.battleWindow).toBeUndefined();
  });

  it("restores an attack response window and can still activate an attack-negating quick effect", () => {
    const session = createDuel({ seed: 55, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const negator = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(negator).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    const makeNegator = (effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition => ({
      ...effect,
      operation(ctx) {
        ctx.log(`restore negate ${negateDuelAttack(ctx.duel)}`);
      },
    });
    registerEffect(session, makeNegator({
      id: "restore-attack-negator",
      registryKey: "restore-attack-negator",
      sourceUid: negator!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
    }));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    expect(session.state.battleWindow).toMatchObject({ kind: "attackNegationResponse", attackerUid: attacker!.uid, responsePlayer: 0 });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-attack-negator": makeNegator,
    });
    expect(restored.state.battleWindow).toEqual(session.state.battleWindow);
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-attack-negator");
    const passAction = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "passAttack");
    expect(action).toBeTruthy();
    expect(passAction).toBeTruthy();
    expect(passAction!.windowToken).toBeDefined();
    expect(groupedActionSummary(restored, 0)).toEqual([
      { label: "Effects", windowId: queryPublicState(restored).actionWindowId, windowKind: "battle", actionTypes: ["activateEffect"] },
      { label: "Pass", windowId: queryPublicState(restored).actionWindowId, windowKind: "battle", actionTypes: ["passAttack"] },
    ]);
    const forgedDamagePass = applyResponse(restored, {
      type: "passDamage",
      player: 0,
      label: "Forge damage response into restored attack window",
      windowId: passAction!.windowId!,
      windowKind: passAction!.windowKind!,
      windowToken: passAction!.windowToken!,
    });
    expect(forgedDamagePass.ok).toBe(false);
    expect(forgedDamagePass.error).toContain("Response is not currently legal");
    expect(forgedDamagePass.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(forgedDamagePass.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(forgedDamagePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(restored.state.battleWindow).toEqual(session.state.battleWindow);
    expect(restored.state.pendingBattle).toEqual(session.state.pendingBattle);
    expect(restored.state.log.some((entry) => entry.detail === "restore negate true")).toBe(false);
    applyAndAssert(restored, action!);
    expect(passCurrentChainIfPending(restored)).toBe(true);
    expect(restored.state.pendingBattle).toBeUndefined();
    expect(restored.state.battleWindow).toBeUndefined();
    expect(restored.state.attackCanceledUids).toEqual([attacker!.uid]);
    expect(restored.state.log.some((entry) => entry.detail === "restore negate true")).toBe(true);
  });

  it("prunes battle-step reset effects after restoring before attack declaration", () => {
    const session = createDuel({ seed: 59, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(source).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    const restoreBattleStepReset = (effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition => ({
      ...effect,
      operation() {},
    });
    registerEffect(session, restoreBattleStepReset({
      id: "restore-battle-step-reset",
      registryKey: "restore-battle-step-reset",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      reset: { flags: 0x40000000 | 0x10 },
    }));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-battle-step-reset": restoreBattleStepReset,
    });
    expect(restored.state.effects).toHaveLength(1);

    const attack = getDuelLegalActions(restored, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid);
    expect(attack).toBeTruthy();
    applyAndAssert(restored, attack!);

    expect(restored.state.battleWindow).toMatchObject({ kind: "attackNegationResponse", attackerUid: attacker!.uid });
    expect(restored.state.effects).toHaveLength(0);
  });

  it("prunes battle-step flag effects after restoring before attack declaration", () => {
    const session = createDuel({ seed: 62, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    session.state.flagEffects.push({ ownerType: "player", ownerId: "0", code: 609, reset: 0x40000000 | 0x10, property: 0, value: 1, turn: session.state.turn });

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.flagEffects.map((flag) => flag.code)).toEqual([609]);

    const attack = getDuelLegalActions(restored, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid);
    expect(attack).toBeTruthy();
    applyAndAssert(restored, attack!);

    expect(restored.state.battleWindow).toMatchObject({ kind: "attackNegationResponse", attackerUid: attacker!.uid });
    expect(restored.state.flagEffects).toHaveLength(0);
  });

  it("keeps turn-qualified battle-step resets until their matching turn", () => {
    const session = createDuel({ seed: 63, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnPlayerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const nonTurnPlayerSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(turnPlayerSource).toBeTruthy();
    expect(nonTurnPlayerSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    const battleStepOpponentTurnReset = 0x40000000 | 0x10 | 0x20000000;
    const restoreResetEffect = (effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition => ({ ...effect, operation() {} });
    registerEffect(session, restoreResetEffect({
      id: "turn-player-opponent-turn-battle-step-reset",
      registryKey: "turn-player-opponent-turn-battle-step-reset",
      sourceUid: turnPlayerSource!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      reset: { flags: battleStepOpponentTurnReset },
    }));
    registerEffect(session, restoreResetEffect({
      id: "non-turn-player-opponent-turn-battle-step-reset",
      registryKey: "non-turn-player-opponent-turn-battle-step-reset",
      sourceUid: nonTurnPlayerSource!.uid,
      controller: 1,
      event: "ignition",
      range: ["hand"],
      reset: { flags: battleStepOpponentTurnReset },
    }));
    session.state.flagEffects.push(
      { ownerType: "player", ownerId: "0", code: 612, reset: battleStepOpponentTurnReset, property: 0, value: 1, turn: session.state.turn },
      { ownerType: "player", ownerId: "1", code: 613, reset: battleStepOpponentTurnReset, property: 0, value: 1, turn: session.state.turn },
    );

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "turn-player-opponent-turn-battle-step-reset": restoreResetEffect,
      "non-turn-player-opponent-turn-battle-step-reset": restoreResetEffect,
    });
    expect(restored.state.effects.map((effect) => effect.id)).toEqual([
      "turn-player-opponent-turn-battle-step-reset",
      "non-turn-player-opponent-turn-battle-step-reset",
    ]);
    expect(restored.state.flagEffects.map((flag) => flag.code)).toEqual([612, 613]);

    const attack = getDuelLegalActions(restored, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid);
    expect(attack).toBeTruthy();
    applyAndAssert(restored, attack!);

    expect(restored.state.battleWindow).toMatchObject({ kind: "attackNegationResponse", attackerUid: attacker!.uid });
    expect(restored.state.effects.map((effect) => effect.id)).toEqual(["turn-player-opponent-turn-battle-step-reset"]);
    expect(restored.state.flagEffects.map((flag) => flag.code)).toEqual([612]);
  });

  it("prunes damage subphase reset effects after restoring an attack response window", () => {
    const session = createDuel({ seed: 60, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const sources = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(sources).toHaveLength(2);
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    const restoreResetEffect = (effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition => ({ ...effect, operation() {} });
    registerEffect(session, restoreResetEffect({
      id: "restore-damage-step-reset",
      registryKey: "restore-damage-step-reset",
      sourceUid: sources[0]!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      reset: { flags: 0x40000000 | 0x20 },
    }));
    registerEffect(session, restoreResetEffect({
      id: "restore-damage-calc-reset",
      registryKey: "restore-damage-calc-reset",
      sourceUid: sources[1]!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      reset: { flags: 0x40000000 | 0x40 },
    }));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-damage-step-reset": restoreResetEffect,
      "restore-damage-calc-reset": restoreResetEffect,
    });
    expect(restored.state.effects.map((effect) => effect.id)).toEqual(["restore-damage-step-reset", "restore-damage-calc-reset"]);

    passBattleWindow(restored);
    expect(restored.state.battleWindow?.kind).toBe("startDamageStep");
    expect(restored.state.effects.map((effect) => effect.id)).toEqual(["restore-damage-step-reset", "restore-damage-calc-reset"]);
    passDamageWindow(restored);
    expect(restored.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(restored.state.effects.map((effect) => effect.id)).toEqual(["restore-damage-step-reset", "restore-damage-calc-reset"]);
    passDamageWindow(restored);

    expect(restored.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(restored.state.effects.map((effect) => effect.id)).toEqual(["restore-damage-step-reset", "restore-damage-calc-reset"]);
    passDamageWindow(restored);
    expect(restored.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(restored.state.effects.map((effect) => effect.id)).toEqual(["restore-damage-step-reset"]);
  });

  it("prunes damage subphase flag effects after restoring an attack response window", () => {
    const session = createDuel({ seed: 61, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    session.state.flagEffects.push(
      { ownerType: "player", ownerId: "0", code: 610, reset: 0x40000000 | 0x20, property: 0, value: 1, turn: session.state.turn },
      { ownerType: "player", ownerId: "0", code: 611, reset: 0x40000000 | 0x40, property: 0, value: 1, turn: session.state.turn },
    );

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.flagEffects.map((flag) => flag.code)).toEqual([610, 611]);

    passBattleWindow(restored);
    expect(restored.state.battleWindow?.kind).toBe("startDamageStep");
    expect(restored.state.flagEffects.map((flag) => flag.code)).toEqual([610, 611]);
    passDamageWindow(restored);
    expect(restored.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(restored.state.flagEffects.map((flag) => flag.code)).toEqual([610, 611]);
    passDamageWindow(restored);

    expect(restored.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(restored.state.flagEffects.map((flag) => flag.code)).toEqual([610, 611]);
    passDamageWindow(restored);
    expect(restored.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(restored.state.flagEffects.map((flag) => flag.code)).toEqual([610]);
  });

  it("restores a pending after-damage trigger and continues the battle window after it resolves", () => {
    const session = createDuel({ seed: 56, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    const makeAfterDamageTrigger = (effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition => ({
      ...effect,
      operation(ctx) {
        ctx.log("restored after damage trigger resolved");
      },
    });
    registerEffect(session, makeAfterDamageTrigger({
      id: "restore-after-damage-trigger",
      registryKey: "restore-after-damage-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "afterDamageCalculation",
      range: ["hand"],
    }));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    for (const expectedKind of ["attackNegationResponse", "attackNegationResponse", "startDamageStep", "startDamageStep", "beforeDamageCalculation", "beforeDamageCalculation", "duringDamageCalculation", "duringDamageCalculation"] as const) {
      expect(session.state.battleWindow?.kind).toBe(expectedKind);
      const player = session.state.battleWindow!.responsePlayer;
      const passType = session.state.battleWindow!.step === "attack" ? "passAttack" : "passDamage";
      applyAndAssert(session, getDuelLegalActions(session, player).find((action) => action.type === passType)!);
    }
    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["afterDamageCalculation"]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-after-damage-trigger": makeAfterDamageTrigger,
    });
    expect(restored.state.battleWindow).toEqual(session.state.battleWindow);
    expect(restored.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    const trigger = getDuelLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-after-damage-trigger");
    expect(trigger).toBeTruthy();
    expect(groupedActionSummary(restored, 0)).toEqual([
      { label: "Trigger Activations", windowId: queryPublicState(restored).actionWindowId, windowKind: "triggerBucket", actionTypes: ["activateTrigger"] },
      { label: "Trigger Declines", windowId: queryPublicState(restored).actionWindowId, windowKind: "triggerBucket", actionTypes: ["declineTrigger"] },
    ]);
    applyAndAssert(restored, trigger!);
    expect(passCurrentChainIfPending(restored)).toBe(true);
    expect(restored.state.pendingTriggers).toEqual([]);
    expect(restored.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(restored.state.log.some((entry) => entry.detail === "restored after damage trigger resolved")).toBe(true);
  });

  it("restores a pending end-damage-step trigger and can finish the battle after it resolves", () => {
    const session = createDuel({ seed: 57, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    const makeEndDamageTrigger = (effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition => ({
      ...effect,
      operation(ctx) {
        ctx.log("restored end damage trigger resolved");
      },
    });
    registerEffect(session, makeEndDamageTrigger({
      id: "restore-end-damage-trigger",
      registryKey: "restore-end-damage-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "damageStepEnded",
      range: ["hand"],
    }));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    for (const expectedKind of [
      "attackNegationResponse",
      "attackNegationResponse",
      "startDamageStep",
      "startDamageStep",
      "beforeDamageCalculation",
      "beforeDamageCalculation",
      "duringDamageCalculation",
      "duringDamageCalculation",
      "afterDamageCalculation",
      "afterDamageCalculation",
    ] as const) {
      expect(session.state.battleWindow?.kind).toBe(expectedKind);
      const player = session.state.battleWindow!.responsePlayer;
      const passType = session.state.battleWindow!.step === "attack" ? "passAttack" : "passDamage";
      applyAndAssert(session, getDuelLegalActions(session, player).find((action) => action.type === passType)!);
    }
    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["damageStepEnded"]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-end-damage-trigger": makeEndDamageTrigger,
    });
    expect(restored.state.battleWindow).toEqual(session.state.battleWindow);
    expect(restored.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    const trigger = getDuelLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-end-damage-trigger");
    expect(trigger).toBeTruthy();
    expect(groupedActionSummary(restored, 0)).toEqual([
      { label: "Trigger Activations", windowId: queryPublicState(restored).actionWindowId, windowKind: "triggerBucket", actionTypes: ["activateTrigger"] },
      { label: "Trigger Declines", windowId: queryPublicState(restored).actionWindowId, windowKind: "triggerBucket", actionTypes: ["declineTrigger"] },
    ]);
    applyAndAssert(restored, trigger!);
    expect(passCurrentChainIfPending(restored)).toBe(true);
    expect(restored.state.pendingTriggers).toEqual([]);
    expect(restored.state.battleWindow?.kind).toBe("endDamageStep");
    expect(restored.state.log.some((entry) => entry.detail === "restored end damage trigger resolved")).toBe(true);
    while (restored.state.battleWindow) {
      const pass = getDuelLegalActions(restored, restored.state.battleWindow.responsePlayer).find((action) => action.type === "passDamage");
      expect(pass).toBeTruthy();
      applyAndAssert(restored, pass!);
    }
    expect(restored.state.battleWindow).toBeUndefined();
    expect(restored.state.pendingBattle).toBeUndefined();
    expect(restored.state.players[1].lifePoints).toBe(6200);
  });

  it("gates quick effects by explicit damage sub-window kind", () => {
    const localCards = [
      ...cards,
      { code: "301", name: "Damage Step Quick A", kind: "monster" as const },
      { code: "302", name: "Damage Step Quick B", kind: "monster" as const },
      { code: "303", name: "Damage Step Quick C", kind: "monster" as const },
      { code: "304", name: "Damage Step Quick D", kind: "monster" as const },
      { code: "400", name: "Damage Calculation Quick", kind: "monster" as const },
      { code: "500", name: "Unflagged Quick", kind: "monster" as const },
    ];
    const session = createDuel({ seed: 52, startingHandSize: 6, cardReader: createCardReader(localCards) });
    loadDecks(session, {
      0: { main: ["100", "301", "302", "303", "304", "400"] },
      1: { main: ["500", "500", "500", "500", "500", "500"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    for (const code of ["301", "302", "303", "304", "400", "500"]) {
      const source = queryPublicState(session).cards.find((card) => card.location === "hand" && card.code === code);
      expect(source).toBeTruthy();
      registerEffect(session, {
        id: `timing-${code}`,
        sourceUid: source!.uid,
        controller: source!.controller,
        event: "quick",
        range: ["hand"],
        oncePerTurn: true,
        ...(code === "400" ? { property: 0x8000 } : code === "500" ? {} : { property: 0x4000 }),
        operation(ctx) {
          ctx.log(`timing ${code}`);
        },
      });
    }

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passAttack")!);

    expect(session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(legalEffectIds(session, 1)).toEqual([]);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    expect(legalEffectIds(session, 0)).toContain("timing-301");
    expect(legalEffectIds(session, 0)).not.toContain("timing-400");
    const startDamageQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "timing-301");
    expect(startDamageQuick).toMatchObject({ windowId: session.state.actionWindowId, windowKind: "battle" });
    applyAndAssert(session, startDamageQuick!);
    expect(passCurrentChainIfPending(session)).toBe(true);

    expect(session.state.battleWindow?.kind).toBe("startDamageStep");
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passDamage")!);
    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(legalEffectIds(session, 1)).toEqual([]);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    expect(legalEffectIds(session, 0)).toContain("timing-302");
    expect(legalEffectIds(session, 0)).not.toContain("timing-400");
    const beforeDamageQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "timing-302");
    expect(beforeDamageQuick).toMatchObject({ windowId: session.state.actionWindowId, windowKind: "battle" });
    applyAndAssert(session, beforeDamageQuick!);
    expect(passCurrentChainIfPending(session)).toBe(true);

    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passDamage")!);
    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    expect(legalEffectIds(session, 0)).toEqual(["timing-400"]);
    const damageCalculationQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "timing-400");
    expect(damageCalculationQuick).toMatchObject({ windowId: session.state.actionWindowId, windowKind: "battle" });
    applyAndAssert(session, damageCalculationQuick!);
    expect(passCurrentChainIfPending(session)).toBe(true);

    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passDamage")!);
    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    expect(legalEffectIds(session, 0)).toContain("timing-303");
    expect(legalEffectIds(session, 0)).not.toContain("timing-400");
    const afterDamageQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "timing-303");
    expect(afterDamageQuick).toMatchObject({ windowId: session.state.actionWindowId, windowKind: "battle" });
    applyAndAssert(session, afterDamageQuick!);
    expect(passCurrentChainIfPending(session)).toBe(true);

    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passDamage")!);
    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    expect(legalEffectIds(session, 0)).toContain("timing-304");
    expect(legalEffectIds(session, 0)).not.toContain("timing-400");
    expect(legalEffectIds(session, 0)).not.toContain("timing-500");
    const endDamageQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "timing-304");
    expect(endDamageQuick).toMatchObject({ windowId: session.state.actionWindowId, windowKind: "battle" });
  });
});

function legalEffectIds(session: ReturnType<typeof createDuel>, player: 0 | 1): string[] {
  return getDuelLegalActions(session, player)
    .filter((action) => action.type === "activateEffect")
    .map((action) => action.effectId);
}

function groupedActionSummary(session: ReturnType<typeof createDuel>, player: 0 | 1) {
  return getGroupedDuelLegalActions(session, player).map((group) => ({
    label: group.label,
    windowId: group.windowId,
    windowKind: group.windowKind,
    actionTypes: group.actions.map((action) => action.type),
  }));
}

function expectResultLegalActions(session: ReturnType<typeof createDuel>, result: ReturnType<typeof applyResponse>): void {
  expect(result.state.waitingFor).toBeDefined();
  expect(result.legalActions).toEqual(getDuelLegalActions(session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const result = applyResponse(session, action);
  expect(result.ok).toBe(true);
  expectResultLegalActions(session, result);
  return result;
}

function passBattleWindow(session: ReturnType<typeof createDuel>): void {
  const firstPlayer = session.state.waitingFor ?? session.state.turnPlayer;
  const firstPass = getDuelLegalActions(session, firstPlayer).find((action) => action.type === "passAttack");
  expect(firstPass).toBeTruthy();
  applyAndAssert(session, firstPass!);
  const secondPlayer = session.state.waitingFor ?? session.state.turnPlayer;
  const secondPass = getDuelLegalActions(session, secondPlayer).find((action) => action.type === "passAttack");
  expect(secondPass).toBeTruthy();
  applyAndAssert(session, secondPass!);
}

function passDamageWindow(session: ReturnType<typeof createDuel>): void {
  const firstPlayer = session.state.waitingFor ?? session.state.turnPlayer;
  const firstPass = getDuelLegalActions(session, firstPlayer).find((action) => action.type === "passDamage");
  expect(firstPass).toBeTruthy();
  applyAndAssert(session, firstPass!);
  const secondPlayer = session.state.waitingFor ?? session.state.turnPlayer;
  const secondPass = getDuelLegalActions(session, secondPlayer).find((action) => action.type === "passDamage");
  expect(secondPass).toBeTruthy();
  applyAndAssert(session, secondPass!);
}

function passCurrentChainIfPending(session: ReturnType<typeof createDuel>): boolean {
  if (!session.state.chain.length) return true;
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const pass = getDuelLegalActions(session, player).find((action) => action.type === "passChain");
  expect(pass).toBeTruthy();
  applyAndAssert(session, pass!);
  return true;
}
