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
  restoreDuel,
  serializeDuel,
  sendDuelCardToGraveyard,
  specialSummonDuelCard,
  startDuel,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards, findPublicCard, setupFailedMoveAfterFirstFixture } from "./full-duel-engine-fixtures.js";

describe("duel rollback", () => {
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

  it("rolls back failed fusion summon material moves from responses", () => {
    const { session, target: fusion, first: firstMaterial, blocked: blockedMaterial } = setupFailedMoveAfterFirstFixture({
      seed: 88,
      main: ["100", "300"],
      extra: ["900"],
      target: { location: "extraDeck", code: "900" },
      first: { location: "hand", code: "100" },
      blocked: { location: "hand", code: "300" },
      block: { id: "cannot-send-second-material", code: 68, range: ["hand"], firstMovedTo: "graveyard" },
    });
    expect(fusion).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("fusionSummon");
    if (!action || action.type !== "fusionSummon") throw new Error("Expected fusion summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === fusion!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("hand");
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(session.state.log.some((entry) => entry.action === "fusionMaterial")).toBe(false);
  });

  it("rolls back failed fusion summon responses after restoring a snapshot", () => {
    const original = createDuel({ seed: 94, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(original, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400", "400"] },
    });
    startDuel(original);
    const session = restoreDuel(serializeDuel(original), createCardReader(cards));

    const fusion = findPublicCard(session, 0, "extraDeck", "900");
    const firstMaterial = findPublicCard(session, 0, "hand", "100");
    const blockedMaterial = findPublicCard(session, 0, "hand", "300");
    expect(fusion).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    registerEffect(session, {
      id: "restored-cannot-send-second-material",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 68,
      range: ["hand"],
      canActivate(ctx) {
        return ctx.duel.cards.find((card) => card.uid === firstMaterial!.uid)?.location === "graveyard";
      },
      operation() {},
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("fusionSummon");
    if (!action || action.type !== "fusionSummon") throw new Error("Expected fusion summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === fusion!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("hand");
    expect(session.state.log.some((entry) => entry.action === "fusionMaterial")).toBe(false);
  });

  it("rolls back failed synchro summon material moves from responses", () => {
    const { session, target: synchro, first: firstMaterial, blocked: blockedMaterial } = setupFailedMoveAfterFirstFixture({
      seed: 89,
      main: ["100", "300"],
      extra: ["910"],
      target: { location: "extraDeck", code: "910" },
      first: { location: "hand", code: "100", moveTo: "monsterZone" },
      blocked: { location: "hand", code: "300", moveTo: "monsterZone" },
      block: { id: "cannot-send-second-synchro-material", code: 68, range: ["monsterZone"], firstMovedTo: "graveyard" },
    });
    expect(synchro).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected synchro summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("monsterZone");
    expect(session.state.log.some((entry) => entry.action === "synchroMaterial")).toBe(false);
  });

  it("rolls back failed Xyz summon material moves from responses", () => {
    const { session, target: xyz, first: firstMaterial, blocked: blockedMaterial } = setupFailedMoveAfterFirstFixture({
      seed: 90,
      main: ["100", "300"],
      extra: ["920"],
      target: { location: "extraDeck", code: "920" },
      first: { location: "hand", code: "100", moveTo: "monsterZone" },
      blocked: { location: "hand", code: "300", moveTo: "monsterZone" },
      block: { id: "cannot-overlay-second-material", code: 238, range: ["monsterZone"], firstMovedTo: "overlay" },
    });
    expect(xyz).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot be used as Xyz material");
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toEqual([]);
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("monsterZone");
    expect(session.state.log.some((entry) => entry.action === "xyzMaterial")).toBe(false);
  });

  it("rolls back failed link summon material moves from responses", () => {
    const { session, target: link, first: firstMaterial, blocked: blockedMaterial } = setupFailedMoveAfterFirstFixture({
      seed: 91,
      main: ["100", "300"],
      extra: ["930"],
      target: { location: "extraDeck", code: "930" },
      first: { location: "hand", code: "100", moveTo: "monsterZone" },
      blocked: { location: "hand", code: "300", moveTo: "monsterZone" },
      block: { id: "cannot-send-second-link-material", code: 68, range: ["monsterZone"], firstMovedTo: "graveyard" },
    });
    expect(link).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === link!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("monsterZone");
    expect(session.state.log.some((entry) => entry.action === "linkMaterial")).toBe(false);
  });

  it("rolls back failed ritual summon material moves from responses", () => {
    const { session, target: ritual, first: firstMaterial, blocked: blockedMaterial } = setupFailedMoveAfterFirstFixture({
      seed: 92,
      main: ["940", "100", "300"],
      target: { location: "hand", code: "940" },
      first: { location: "hand", code: "100" },
      blocked: { location: "hand", code: "300" },
      block: { id: "cannot-send-second-ritual-material", code: 68, range: ["hand"], firstMovedTo: "graveyard" },
    });
    expect(ritual).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "ritualSummon" && candidate.uid === ritual!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("ritualSummon");
    if (!action || action.type !== "ritualSummon") throw new Error("Expected ritual summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === ritual!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("hand");
    expect(session.state.log.some((entry) => entry.action === "ritualMaterial")).toBe(false);
  });

  it("rolls back failed tribute summon release moves from responses", () => {
    const { session, target: tributeMonster, first: firstTribute, blocked: blockedTribute } = setupFailedMoveAfterFirstFixture({
      seed: 93,
      main: ["700", "100", "300"],
      target: { location: "hand", code: "700" },
      first: { location: "hand", code: "100", moveTo: "monsterZone" },
      blocked: { location: "hand", code: "300", moveTo: "monsterZone" },
      block: { id: "cannot-send-second-tribute", code: 68, range: ["monsterZone"], firstMovedTo: "graveyard" },
    });
    expect(tributeMonster).toBeTruthy();
    expect(firstTribute).toBeTruthy();
    expect(blockedTribute).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "tributeSummon" && candidate.uid === tributeMonster!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("tributeSummon");
    if (!action || action.type !== "tributeSummon") throw new Error("Expected tribute summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === firstTribute!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === blockedTribute!.uid)?.location).toBe("monsterZone");
    expect(session.state.log.some((entry) => entry.action === "release")).toBe(false);
  });
});
