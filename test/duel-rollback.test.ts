import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  restoreDuel,
  serializeDuel,
  sendDuelCardToGraveyard,
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
});
