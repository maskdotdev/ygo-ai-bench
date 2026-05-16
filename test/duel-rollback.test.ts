import { describe, expect, it } from "vitest";
import { addDuelCardCounter } from "#duel/counters.js";
import {
  addDuelChainLimit,
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  sendDuelCardToGraveyard,
  specialSummonDuelCard,
  startDuel,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import { captureDuelState, restoreDuelState } from "#duel/state-rollback.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("duel rollback", () => {
  it("captures every mutable duel state key", () => {
    const session = createDuel({ seed: 136, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const rollback = captureDuelState(session.state);
    const identityAndConfigKeys = new Set(["id", "seed", "options"]);
    const missingKeys = Object.keys(session.state)
      .filter((key) => !identityAndConfigKeys.has(key))
      .filter((key) => !(key in rollback));

    expect(missingKeys).toEqual([]);
  });

  it("rolls back chain operation failures", () => {
    const session = createDuel({ seed: 84, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const moved = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(moved).toBeTruthy();

    registerEffect(session, {
      id: "failing-operation",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, moved!.uid, ctx.player);
        throw new Error("operation failed");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "failing-operation");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("operation failed");
    expect(session.state.cards.find((card) => card.uid === source!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === moved!.uid)?.location).toBe("hand");
    expect(session.state.chain).toHaveLength(0);
    expect(session.state.status).toBe("awaiting");
  });

  it("rolls back failed activation costs", () => {
    const session = createDuel({ seed: 82, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const costCard = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(costCard).toBeTruthy();

    registerEffect(session, {
      id: "failed-cost",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      cost(ctx) {
        if (ctx.checkOnly) return true;
        sendDuelCardToGraveyard(ctx.duel, costCard!.uid, ctx.player, duelReason.cost);
        return false;
      },
      operation(ctx) {
        ctx.log("should not resolve");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "failed-cost");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cost for failed-cost could not be paid");
    expect(session.state.cards.find((card) => card.uid === source!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === costCard!.uid)?.location).toBe("hand");
    expect(session.state.chain).toHaveLength(0);
  });

  it("rolls back chain limits added by failed activation targets", () => {
    const session = createDuel({ seed: 126, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "failed-target-chain-limit",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      target(ctx) {
        if (ctx.checkOnly) return true;
        addDuelChainLimit(ctx.duel, {
          registryKey: "leaked-chain-limit",
          untilChainEnd: true,
          allows: () => false,
        });
        return false;
      },
      operation(ctx) {
        ctx.log("should not resolve");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "failed-target-chain-limit");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Targets for failed-target-chain-limit are not legal");
    expect(session.state.chainLimits).toEqual([]);
    expect(session.state.chain).toHaveLength(0);
  });

  it("rolls back shuffle-check state changed by failed activation targets", () => {
    const session = createDuel({ seed: 127, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "failed-target-shuffle-check",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      target(ctx) {
        if (ctx.checkOnly) return true;
        ctx.duel.shuffleCheckDisabled = true;
        return false;
      },
      operation(ctx) {
        ctx.log("should not resolve");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "failed-target-shuffle-check");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Targets for failed-target-shuffle-check are not legal");
    expect(session.state.shuffleCheckDisabled).toBe(false);
    expect(session.state.chain).toHaveLength(0);
  });

  it("rolls back skipped phases changed by failed activation targets", () => {
    const session = createDuel({ seed: 135, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "failed-target-skip-phase",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      target(ctx) {
        if (ctx.checkOnly) return true;
        ctx.duel.skippedPhases.push({ player: 0, phase: "battle", remaining: 1 });
        return false;
      },
      operation(ctx) {
        ctx.log("should not resolve");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "failed-target-skip-phase");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Targets for failed-target-skip-phase are not legal");
    expect(session.state.skippedPhases).toEqual([]);
    expect(session.state.chain).toHaveLength(0);
  });

  it("rolls back nested card counters changed by failed activation targets", () => {
    const session = createDuel({ seed: 128, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const counterTarget = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(counterTarget).toBeTruthy();
    registerEffect(session, {
      id: "failed-target-card-counter",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      target(ctx) {
        if (ctx.checkOnly) return true;
        expect(addDuelCardCounter(counterTarget, 99, 1)).toBe(true);
        return false;
      },
      operation(ctx) {
        ctx.log("should not resolve");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "failed-target-card-counter");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Targets for failed-target-card-counter are not legal");
    expect(session.state.cards.find((card) => card.uid === counterTarget!.uid)?.counters).toBeUndefined();
    expect(session.state.chain).toHaveLength(0);
  });

  it("rolls back nested prompt options", () => {
    const session = createDuel({ seed: 129, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    session.state.prompt = { id: "rollback-options", type: "selectOption", player: 0, options: [1, 2], descriptions: [101, 202], returnTo: 0 };
    const rollback = captureDuelState(session.state);

    session.state.prompt.options.push(3);
    session.state.prompt.descriptions?.push(303);
    restoreDuelState(session.state, rollback);
    if (session.state.prompt?.type !== "selectOption") throw new Error("Expected select-option prompt");

    expect(session.state.prompt.options).toEqual([1, 2]);
    expect(session.state.prompt.descriptions).toEqual([101, 202]);
    if (rollback.prompt?.type === "selectOption") {
      rollback.prompt.options.push(4);
      rollback.prompt.descriptions?.push(404);
    }
    expect(session.state.prompt.options).toEqual([1, 2]);
    expect(session.state.prompt.descriptions).toEqual([101, 202]);
  });

  it("rolls back nested pending battle damage overrides", () => {
    const session = createDuel({ seed: 130, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    session.state.pendingBattle = { attackerUid: "attacker", targetUid: "target", battleDamageOverrides: { 1: 600 } };
    const rollback = captureDuelState(session.state);

    session.state.pendingBattle.battleDamageOverrides![1] = 1200;
    restoreDuelState(session.state, rollback);

    expect(session.state.pendingBattle?.battleDamageOverrides).toEqual({ 1: 600 });
    if (rollback.pendingBattle?.battleDamageOverrides === undefined) throw new Error("Expected rollback battle damage overrides");
    rollback.pendingBattle.battleDamageOverrides[1] = 1800;
    expect(session.state.pendingBattle?.battleDamageOverrides).toEqual({ 1: 600 });
  });

  it("rolls back nested effect metadata arrays", () => {
    const session = createDuel({ seed: 131, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "rollback-effect-metadata",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      targetRange: [1, 2],
      hintTiming: [4, 8],
      labelObjectUids: [source!.uid],
      operation(ctx) {
        ctx.log("metadata effect");
      },
    });
    const rollback = captureDuelState(session.state);

    session.state.effects[0]!.targetRange![0] = 9;
    session.state.effects[0]!.hintTiming!.push(16);
    session.state.effects[0]!.labelObjectUids!.push("mutated-label-object");
    restoreDuelState(session.state, rollback);

    expect(session.state.effects[0]?.targetRange).toEqual([1, 2]);
    expect(session.state.effects[0]?.hintTiming).toEqual([4, 8]);
    expect(session.state.effects[0]?.labelObjectUids).toEqual([source!.uid]);
    rollback.effects[0]!.targetRange![0] = 12;
    rollback.effects[0]!.hintTiming!.push(32);
    rollback.effects[0]!.labelObjectUids!.push("rollback-label-object");
    expect(session.state.effects[0]?.targetRange).toEqual([1, 2]);
    expect(session.state.effects[0]?.hintTiming).toEqual([4, 8]);
    expect(session.state.effects[0]?.labelObjectUids).toEqual([source!.uid]);
  });

  it("rolls back nested chain target arrays", () => {
    const session = createDuel({ seed: 132, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    session.state.chain = [
      {
        id: "chain-1",
        player: 0,
        sourceUid: "source",
        effectId: "effect",
        targetUids: ["target-a", "target-b"],
        operationOverride(ctx) {
          ctx.log("chain link");
        },
      },
    ];
    const rollback = captureDuelState(session.state);

    session.state.chain[0]!.targetUids!.push("target-c");
    restoreDuelState(session.state, rollback);

    expect(session.state.chain[0]?.targetUids).toEqual(["target-a", "target-b"]);
    rollback.chain[0]!.targetUids!.push("target-d");
    expect(session.state.chain[0]?.targetUids).toEqual(["target-a", "target-b"]);
  });

  it("rolls back nested event uid arrays without sharing rollback objects", () => {
    const session = createDuel({ seed: 134, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.chain = [{
      id: "chain-1",
      player: 0,
      sourceUid,
      effectId: "effect",
      eventUids: [sourceUid],
      effectLabels: [10, 20],
      effectLabelObjectUids: [sourceUid],
    }];
    session.state.pendingTriggers = [{
      id: "trigger-1",
      player: 0,
      sourceUid,
      effectId: "effect",
      eventName: "customEvent",
      triggerBucket: "turnOptional",
      eventUids: [sourceUid],
      effectLabelObjectUids: [sourceUid],
    }];
    session.state.eventHistory = [{ eventName: "customEvent", eventUids: [sourceUid] }];
    const rollback = captureDuelState(session.state);

    session.state.chain[0]!.eventUids!.push("chain-mutation");
    session.state.chain[0]!.effectLabels!.push(30);
    session.state.chain[0]!.effectLabelObjectUids!.push("chain-label-mutation");
    session.state.pendingTriggers[0]!.eventUids!.push("trigger-mutation");
    session.state.pendingTriggers[0]!.effectLabelObjectUids!.push("trigger-label-mutation");
    session.state.eventHistory[0]!.eventUids!.push("history-mutation");
    restoreDuelState(session.state, rollback);
    expect(session.state.chain[0]?.eventUids).toEqual([sourceUid]);
    expect(session.state.chain[0]?.effectLabels).toEqual([10, 20]);
    expect(session.state.chain[0]?.effectLabelObjectUids).toEqual([sourceUid]);
    expect(session.state.pendingTriggers[0]?.eventUids).toEqual([sourceUid]);
    expect(session.state.pendingTriggers[0]?.effectLabelObjectUids).toEqual([sourceUid]);
    expect(session.state.eventHistory[0]?.eventUids).toEqual([sourceUid]);
    rollback.chain[0]!.eventUids!.push("rollback-chain-mutation");
    rollback.chain[0]!.effectLabels!.push(40);
    rollback.chain[0]!.effectLabelObjectUids!.push("rollback-chain-label-mutation");
    rollback.pendingTriggers[0]!.eventUids!.push("rollback-trigger-mutation");
    rollback.pendingTriggers[0]!.effectLabelObjectUids!.push("rollback-trigger-label-mutation");
    rollback.eventHistory[0]!.eventUids!.push("rollback-history-mutation");
    expect(session.state.chain[0]?.eventUids).toEqual([sourceUid]);
    expect(session.state.chain[0]?.effectLabels).toEqual([10, 20]);
    expect(session.state.chain[0]?.effectLabelObjectUids).toEqual([sourceUid]);
    expect(session.state.pendingTriggers[0]?.eventUids).toEqual([sourceUid]);
    expect(session.state.pendingTriggers[0]?.effectLabelObjectUids).toEqual([sourceUid]);
    expect(session.state.eventHistory[0]?.eventUids).toEqual([sourceUid]);
  });

  it("rolls back nested card state without sharing rollback objects", () => {
    const session = createDuel({ seed: 133, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === "100");
    expect(card).toBeTruthy();
    card!.overlayUids.push("overlay-a");
    card!.counters = { 1: 2 };
    card!.counterBuckets = { 1: { permanent: 1, resetWhileNegated: 1 } };
    card!.effectRelationIds = [101];
    card!.cardTargetUids = ["target-a"];
    card!.summonMaterialUids = ["material-a"];
    card!.assumedProperties = { 10: 999 };
    card!.uniqueOnField = { self: true, opponent: false, code: 100, locationMask: 0x04 };
    card!.data = { ...card!.data, setcodes: [0x10], fusionMaterials: ["100"], synchroMaterials: { tuner: "100", nonTuners: ["300"] } };
    const rollback = captureDuelState(session.state);

    card!.overlayUids.push("overlay-b");
    card!.counters[1] = 5;
    card!.counterBuckets[1]!.resetWhileNegated = 4;
    card!.effectRelationIds!.push(102);
    card!.cardTargetUids.push("target-b");
    card!.summonMaterialUids.push("material-b");
    card!.assumedProperties![10] = 888;
    card!.uniqueOnField!.code = 200;
    card!.data.setcodes!.push(0x20);
    card!.data.fusionMaterials!.push("300");
    card!.data.synchroMaterials!.nonTuners.push("400");
    restoreDuelState(session.state, rollback);

    const restored = session.state.cards.find((candidate) => candidate.uid === card!.uid);
    expect(restored?.overlayUids).toEqual(["overlay-a"]);
    expect(restored?.counters).toEqual({ 1: 2 });
    expect(restored?.counterBuckets).toEqual({ 1: { permanent: 1, resetWhileNegated: 1 } });
    expect(restored?.effectRelationIds).toEqual([101]);
    expect(restored?.cardTargetUids).toEqual(["target-a"]);
    expect(restored?.summonMaterialUids).toEqual(["material-a"]);
    expect(restored?.assumedProperties).toEqual({ 10: 999 });
    expect(restored?.uniqueOnField).toEqual({ self: true, opponent: false, code: 100, locationMask: 0x04 });
    expect(restored?.data.setcodes).toEqual([0x10]);
    expect(restored?.data.fusionMaterials).toEqual(["100"]);
    expect(restored?.data.synchroMaterials).toEqual({ tuner: "100", nonTuners: ["300"] });

    const rollbackCard = rollback.cards.find((candidate) => candidate.uid === card!.uid);
    expect(rollbackCard).toBeTruthy();
    rollbackCard!.overlayUids.push("overlay-c");
    rollbackCard!.counters![1] = 7;
    rollbackCard!.counterBuckets![1]!.permanent = 7;
    rollbackCard!.effectRelationIds!.push(103);
    rollbackCard!.cardTargetUids!.push("target-c");
    rollbackCard!.summonMaterialUids!.push("material-c");
    rollbackCard!.assumedProperties![10] = 777;
    rollbackCard!.uniqueOnField!.code = 300;
    rollbackCard!.data.setcodes!.push(0x30);
    rollbackCard!.data.fusionMaterials!.push("400");
    rollbackCard!.data.synchroMaterials!.nonTuners.push("500");
    expect(restored?.overlayUids).toEqual(["overlay-a"]);
    expect(restored?.counters).toEqual({ 1: 2 });
    expect(restored?.counterBuckets).toEqual({ 1: { permanent: 1, resetWhileNegated: 1 } });
    expect(restored?.effectRelationIds).toEqual([101]);
    expect(restored?.cardTargetUids).toEqual(["target-a"]);
    expect(restored?.summonMaterialUids).toEqual(["material-a"]);
    expect(restored?.assumedProperties).toEqual({ 10: 999 });
    expect(restored?.uniqueOnField).toEqual({ self: true, opponent: false, code: 100, locationMask: 0x04 });
    expect(restored?.data.setcodes).toEqual([0x10]);
    expect(restored?.data.fusionMaterials).toEqual(["100"]);
    expect(restored?.data.synchroMaterials).toEqual({ tuner: "100", nonTuners: ["300"] });
  });

  it("rolls back flat state collections without sharing rollback objects", () => {
    const session = createDuel({ seed: 134, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    session.state.lastDiceResults = [2, 5];
    session.state.lastCoinResults = [1];
    session.state.players[0].lifePoints = 7000;
    session.state.chainPasses = [0];
    session.state.pendingTriggers = [
      { id: "trigger-a", player: 0, sourceUid: "source", effectId: "effect", eventName: "customEvent", triggerBucket: "turnOptional" },
    ];
    session.state.eventHistory = [{ eventName: "customEvent", eventCode: 10 }];
    session.state.usedCountKeys = ["count-a"];
    session.state.flagEffects = [{ ownerType: "player", ownerId: "0", code: 1, reset: 2, property: 3, value: 4, turn: 5 }];
    session.state.activityCounts[0].attack = 1;
    session.state.activityHistory = [{ player: 0, activity: 7, cardUid: "card-a" }];
    session.state.battleDamage = { 0: 100, 1: 200 };
    session.state.attacksDeclared = ["attack-a"];
    session.state.attackCanceledUids = ["cancel-a"];
    session.state.attackedTargetUids = ["target-a"];
    session.state.battlePairs = [{ attackerUid: "attacker-a", targetUid: "target-a" }];
    session.state.attackPasses = [0];
    session.state.damagePasses = [1];
    session.state.positionsChanged = ["position-a"];
    session.state.currentAttack = { attackerUid: "attacker-a", targetUid: "target-a", replayTargetCount: 1, replayTargetUids: ["target-a"] };
    session.state.pendingBattle = { attackerUid: "attacker-a", targetUid: "target-a", replayTargetCount: 1, replayTargetUids: ["target-a"] };
    session.state.log = [{ step: 1, action: "snapshot", player: 0, detail: "snapshot" }];
    const rollback = captureDuelState(session.state);

    session.state.lastDiceResults.push(6);
    session.state.lastCoinResults.push(0);
    session.state.players[0].lifePoints = 5000;
    session.state.chainPasses.push(1);
    session.state.pendingTriggers[0]!.effectId = "effect-mutated";
    session.state.eventHistory[0]!.eventCode = 20;
    session.state.usedCountKeys.push("count-b");
    session.state.flagEffects[0]!.value = 8;
    session.state.activityCounts[0].attack = 3;
    session.state.activityHistory[0]!.activity = 9;
    session.state.battleDamage[0] = 300;
    session.state.attacksDeclared.push("attack-b");
    session.state.attackCanceledUids.push("cancel-b");
    session.state.attackedTargetUids.push("target-b");
    session.state.battlePairs[0]!.targetUid = "target-b";
    session.state.attackPasses.push(1);
    session.state.damagePasses.push(0);
    session.state.positionsChanged.push("position-b");
    session.state.currentAttack.targetUid = "target-b";
    session.state.currentAttack.replayTargetUids!.push("target-b");
    session.state.pendingBattle.replayTargetUids!.push("target-b");
    session.state.log[0]!.action = "mutated";
    restoreDuelState(session.state, rollback);

    expect(session.state.lastDiceResults).toEqual([2, 5]);
    expect(session.state.lastCoinResults).toEqual([1]);
    expect(session.state.players[0].lifePoints).toBe(7000);
    expect(session.state.chainPasses).toEqual([0]);
    expect(session.state.pendingTriggers[0]?.effectId).toBe("effect");
    expect(session.state.eventHistory[0]?.eventCode).toBe(10);
    expect(session.state.usedCountKeys).toEqual(["count-a"]);
    expect(session.state.flagEffects[0]?.value).toBe(4);
    expect(session.state.activityCounts[0].attack).toBe(1);
    expect(session.state.activityHistory[0]?.activity).toBe(7);
    expect(session.state.battleDamage).toEqual({ 0: 100, 1: 200 });
    expect(session.state.attacksDeclared).toEqual(["attack-a"]);
    expect(session.state.attackCanceledUids).toEqual(["cancel-a"]);
    expect(session.state.attackedTargetUids).toEqual(["target-a"]);
    expect(session.state.battlePairs).toEqual([{ attackerUid: "attacker-a", targetUid: "target-a" }]);
    expect(session.state.attackPasses).toEqual([0]);
    expect(session.state.damagePasses).toEqual([1]);
    expect(session.state.positionsChanged).toEqual(["position-a"]);
    expect(session.state.currentAttack).toEqual({ attackerUid: "attacker-a", targetUid: "target-a", replayTargetCount: 1, replayTargetUids: ["target-a"] });
    expect(session.state.pendingBattle).toEqual({ attackerUid: "attacker-a", targetUid: "target-a", replayTargetCount: 1, replayTargetUids: ["target-a"] });
    expect(session.state.log[0]?.action).toBe("snapshot");

    rollback.lastDiceResults.push(4);
    rollback.lastCoinResults.push(0);
    rollback.players[0].lifePoints = 6000;
    rollback.chainPasses.push(1);
    rollback.pendingTriggers[0]!.effectId = "rollback-mutated";
    rollback.eventHistory[0]!.eventCode = 30;
    rollback.usedCountKeys.push("count-c");
    rollback.flagEffects[0]!.value = 10;
    rollback.activityCounts[0].attack = 11;
    rollback.activityHistory[0]!.activity = 12;
    rollback.battleDamage[0] = 400;
    rollback.attacksDeclared.push("attack-c");
    rollback.attackCanceledUids.push("cancel-c");
    rollback.attackedTargetUids.push("target-c");
    rollback.battlePairs[0]!.targetUid = "target-c";
    rollback.attackPasses.push(1);
    rollback.damagePasses.push(0);
    rollback.positionsChanged.push("position-c");
    rollback.currentAttack!.targetUid = "target-c";
    rollback.currentAttack!.replayTargetUids!.push("target-c");
    rollback.pendingBattle!.replayTargetUids!.push("target-c");
    rollback.log[0]!.action = "rollback-mutated";

    expect(session.state.lastDiceResults).toEqual([2, 5]);
    expect(session.state.lastCoinResults).toEqual([1]);
    expect(session.state.players[0].lifePoints).toBe(7000);
    expect(session.state.chainPasses).toEqual([0]);
    expect(session.state.pendingTriggers[0]?.effectId).toBe("effect");
    expect(session.state.eventHistory[0]?.eventCode).toBe(10);
    expect(session.state.usedCountKeys).toEqual(["count-a"]);
    expect(session.state.flagEffects[0]?.value).toBe(4);
    expect(session.state.activityCounts[0].attack).toBe(1);
    expect(session.state.activityHistory[0]?.activity).toBe(7);
    expect(session.state.battleDamage).toEqual({ 0: 100, 1: 200 });
    expect(session.state.attacksDeclared).toEqual(["attack-a"]);
    expect(session.state.attackCanceledUids).toEqual(["cancel-a"]);
    expect(session.state.attackedTargetUids).toEqual(["target-a"]);
    expect(session.state.battlePairs).toEqual([{ attackerUid: "attacker-a", targetUid: "target-a" }]);
    expect(session.state.attackPasses).toEqual([0]);
    expect(session.state.damagePasses).toEqual([1]);
    expect(session.state.positionsChanged).toEqual(["position-a"]);
    expect(session.state.currentAttack).toEqual({ attackerUid: "attacker-a", targetUid: "target-a", replayTargetCount: 1, replayTargetUids: ["target-a"] });
    expect(session.state.pendingBattle).toEqual({ attackerUid: "attacker-a", targetUid: "target-a", replayTargetCount: 1, replayTargetUids: ["target-a"] });
    expect(session.state.log[0]?.action).toBe("snapshot");
  });

  it("rolls back failed trigger activation costs and keeps the trigger pending", () => {
    const session = createDuel({ seed: 83, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const costCard = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    expect(costCard).toBeTruthy();

    registerEffect(session, {
      id: "failed-trigger-cost",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      cost(ctx) {
        if (ctx.checkOnly) return true;
        sendDuelCardToGraveyard(ctx.duel, costCard!.uid, ctx.player, duelReason.cost);
        return false;
      },
      operation(ctx) {
        ctx.log("should not resolve");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "failed-trigger-cost");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cost for failed-trigger-cost could not be paid");
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.cards.find((card) => card.uid === triggerSource!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === costCard!.uid)?.location).toBe("hand");
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateTrigger" && action.effectId === "failed-trigger-cost")).toBe(true);
  });

  it("rolls back failed trigger targets and keeps the trigger pending", () => {
    const session = createDuel({ seed: 86, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const targetCard = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    expect(targetCard).toBeTruthy();

    registerEffect(session, {
      id: "failed-trigger-target",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      target(ctx) {
        if (ctx.checkOnly) return true;
        sendDuelCardToGraveyard(ctx.duel, targetCard!.uid, ctx.player);
        return false;
      },
      operation(ctx) {
        ctx.log("should not resolve");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "failed-trigger-target");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Targets for failed-trigger-target are not legal");
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.chain).toHaveLength(0);
    expect(session.state.cards.find((card) => card.uid === triggerSource!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === targetCard!.uid)?.location).toBe("hand");
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateTrigger" && action.effectId === "failed-trigger-target")).toBe(true);
  });

  it("rolls back failed trigger operations and effect usage", () => {
    const session = createDuel({ seed: 87, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const moved = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    expect(moved).toBeTruthy();

    registerEffect(session, {
      id: "failed-trigger-operation",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, moved!.uid, ctx.player);
        throw new Error("trigger operation failed");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "failed-trigger-operation");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("trigger operation failed");
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.chain).toHaveLength(0);
    expect(session.state.usedCountKeys).toHaveLength(0);
    expect(session.state.cards.find((card) => card.uid === triggerSource!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === moved!.uid)?.location).toBe("hand");
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateTrigger" && action.effectId === "failed-trigger-operation")).toBe(true);
  });

  it("rolls back mandatory trigger count pruning after failed activation", () => {
    const session = createDuel({ seed: 95, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(firstSource).toBeTruthy();
    expect(secondSource).toBeTruthy();

    registerEffect(session, {
      id: "failed-mandatory-shared-count",
      sourceUid: firstSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      optional: false,
      range: ["hand"],
      countLimit: 1,
      countLimitCode: 0x5350,
      operation() {
        throw new Error("mandatory shared count operation failed");
      },
    });
    registerEffect(session, {
      id: "sibling-mandatory-shared-count",
      sourceUid: secondSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      optional: false,
      range: ["hand"],
      countLimit: 1,
      countLimitCode: 0x5350,
      operation(ctx) {
        ctx.log("Sibling mandatory shared count resolved");
      },
    });

    specialSummonDuelCard(session.state, summoned!.uid);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["failed-mandatory-shared-count", "sibling-mandatory-shared-count"]);
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "failed-mandatory-shared-count");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("mandatory shared count operation failed");
    expect(session.state.usedCountKeys).toHaveLength(0);
    expect(session.state.chain).toHaveLength(0);
    expect(session.state.pendingTriggers.map((pending) => pending.effectId)).toEqual(["failed-mandatory-shared-count", "sibling-mandatory-shared-count"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([
      "failed-mandatory-shared-count",
      "sibling-mandatory-shared-count",
    ]);
  });

});
