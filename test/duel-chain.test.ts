import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  restoreDuel,
  sendDuelCardToGraveyard,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel chains", () => {
  it("resolves registered once-per-turn effects through the chain", () => {
    const session = createDuel({ seed: 2, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "send-self",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("Sent itself to the Graveyard");
      },
    });

    const effect = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "send-self");
    expect(effect).toBeTruthy();
    const result = applyAndAssert(session, effect!);

    expect(result.ok).toBe(true);
    expect(result.state.chain).toHaveLength(0);
    expect(result.state.cards.find((card) => card.uid === source!.uid)?.location).toBe("graveyard");
    expect(result.state.log.some((entry) => entry.detail.includes("Sent itself"))).toBe(true);
  });

  it("removes reset-chain effects after their chain resolves", () => {
    const session = createDuel({ seed: 127, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "reset-after-chain",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      reset: { flags: 0x80000000 },
      operation(ctx) {
        ctx.log("Reset chain effect resolved");
      },
    });

    const effect = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "reset-after-chain");
    expect(effect).toBeTruthy();
    const result = applyAndAssert(session, effect!);

    expect(result.ok).toBe(true);
    expect(result.state.chain).toHaveLength(0);
    expect(result.state.log.some((entry) => entry.detail === "Reset chain effect resolved")).toBe(true);
    expect(session.state.effects).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "reset-after-chain")).toBe(false);
  });

  it("counts resolved chains before removing reset-chain effects", () => {
    const session = createDuel({ seed: 128, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const counted = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const starter = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(counted).toBeTruthy();
    expect(starter).toBeTruthy();
    registerEffect(session, {
      id: "counted-reset-chain",
      sourceUid: counted!.uid,
      controller: 0,
      event: "continuous",
      range: ["hand"],
      reset: { flags: 0x80000000, count: 2 },
      operation() {},
    });
    registerEffect(session, {
      id: "first-chain-starter",
      sourceUid: starter!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("First reset chain counter");
      },
    });

    const starterAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "first-chain-starter");
    expect(starterAction).toBeTruthy();
    applyAndAssert(session, starterAction!);
    expect(session.state.effects.find((effect) => effect.id === "counted-reset-chain")).toMatchObject({ reset: { count: 1 } });

    registerEffect(session, {
      id: "second-chain-starter",
      sourceUid: starter!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Second reset chain counter");
      },
    });
    const secondAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "second-chain-starter");
    expect(secondAction).toBeTruthy();
    applyAndAssert(session, secondAction!);

    expect(session.state.effects.some((effect) => effect.id === "counted-reset-chain")).toBe(false);
  });

  it("clears effect count usage when reset-chain removes an effect", () => {
    const session = createDuel({ seed: 130, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "reset-chain-count-limited",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      countLimit: 1,
      reset: { flags: 0x80000000 },
      operation(ctx) {
        ctx.log("Reset chain count-limited effect resolved");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "reset-chain-count-limited");
    expect(action).toBeTruthy();
    applyAndAssert(session, action!);

    expect(session.state.effects).toHaveLength(0);
    expect(session.state.usedCountKeys).toHaveLength(0);
  });

  it("lets an opponent quick effect chain before the original operation resolves", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const originalSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(originalSource).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, {
      id: "original-effect",
      sourceUid: originalSource!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Original operation resolved");
      },
    });
    registerEffect(session, {
      id: "quick-response",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Quick response resolved");
      },
    });

    const original = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "original-effect");
    expect(original).toBeTruthy();
    const opened = applyAndAssert(session, original!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.waitingFor).toBe(1);
    expect(opened.state.log.some((entry) => entry.detail === "Original operation resolved")).toBe(false);

    const response = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "quick-response");
    expect(response).toBeTruthy();
    const chained = applyAndAssert(session, response!);

    expect(chained.ok).toBe(true);
    expect(chained.state.chain).toHaveLength(2);
    expect(chained.state.waitingFor).toBe(1);
    expect(chained.state.log.some((entry) => entry.detail === "Original operation resolved")).toBe(false);

    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeTruthy();
    const resolved = applyAndAssert(session, pass!);
    const quickLog = resolved.state.log.find((entry) => entry.detail === "Quick response resolved");
    const originalLog = resolved.state.log.find((entry) => entry.detail === "Original operation resolved");

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(quickLog).toBeTruthy();
    expect(originalLog).toBeTruthy();
    expect(quickLog!.step).toBeLessThan(originalLog!.step);
  });

  it("persists targets on delayed chain links", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "500");
    const responseSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    expect(responseSource).toBeTruthy();
    registerEffect(session, {
      id: "targeted-send",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      target(ctx) {
        ctx.setTargets([target!.uid]);
        return true;
      },
      operation(ctx) {
        const [selected] = ctx.getTargets();
        if (selected) ctx.moveCard(selected.uid, "graveyard", selected.controller);
        ctx.log(`Resolved with ${ctx.targetUids.length} target`);
      },
    });
    registerEffect(session, {
      id: "target-response",
      sourceUid: responseSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Response resolved before target");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "targeted-send");
    expect(action).toBeTruthy();
    const opened = applyAndAssert(session, action!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.chain[0]?.targetUids).toEqual([target!.uid]);
    expect(opened.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("hand");

    const response = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "target-response");
    expect(response).toBeTruthy();
    const chained = applyAndAssert(session, response!);

    expect(chained.ok).toBe(true);
    expect(chained.state.chain).toHaveLength(2);
    expect(chained.state.waitingFor).toBe(1);
    expect(chained.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("hand");

    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeTruthy();
    const resolved = applyAndAssert(session, pass!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("graveyard");
    expect(resolved.state.log.some((entry) => entry.detail === "Response resolved before target")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Resolved with 1 target")).toBe(true);
  });

  it("allows quick effects to negate earlier chain links", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const originalSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(originalSource).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, {
      id: "negated-original",
      sourceUid: originalSource!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("Negated operation should not resolve");
      },
    });
    registerEffect(session, {
      id: "negating-response",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        const target = ctx.duel.chain.find((link) => link.effectId === "negated-original");
        if (target) ctx.negateChainLink(target.id);
        ctx.log("Negation resolved");
      },
    });

    const original = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "negated-original");
    expect(original).toBeTruthy();
    const opened = applyAndAssert(session, original!);
    expect(opened.state.chain).toHaveLength(1);

    const response = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "negating-response");
    expect(response).toBeTruthy();
    const chained = applyAndAssert(session, response!);

    expect(chained.ok).toBe(true);
    expect(chained.state.chain).toHaveLength(2);
    expect(chained.state.waitingFor).toBe(1);
    expect(chained.state.cards.find((card) => card.uid === originalSource!.uid)?.location).toBe("hand");

    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeTruthy();
    const resolved = applyAndAssert(session, pass!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.cards.find((card) => card.uid === originalSource!.uid)?.location).toBe("hand");
    expect(resolved.state.log.some((entry) => entry.action === "negate" && entry.detail === "negated-original")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.action === "chainNegated" && entry.detail === "negated-original")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Negation resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Negated operation should not resolve")).toBe(false);
  });

  it("resolves a pending chain when the responding player passes", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const originalSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(originalSource).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, {
      id: "pass-original",
      sourceUid: originalSource!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Passed chain resolved");
      },
    });
    registerEffect(session, {
      id: "available-quick",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Should not resolve");
      },
    });

    const original = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "pass-original");
    expect(original).toBeTruthy();
    expect(applyAndAssert(session, original!).state.chain).toHaveLength(1);

    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeTruthy();
    const resolved = applyAndAssert(session, pass!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.log.some((entry) => entry.detail === "Passed chain resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Should not resolve")).toBe(false);
  });

  it("rolls back failed chain resolution after a pass", () => {
    const session = createDuel({ seed: 85, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const moved = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(source).toBeTruthy();
    expect(moved).toBeTruthy();
    expect(quickSource).toBeTruthy();

    registerEffect(session, {
      id: "pass-failing-operation",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, moved!.uid, ctx.player);
        throw new Error("passed operation failed");
      },
    });
    registerEffect(session, {
      id: "available-pass-response",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Unused response");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "pass-failing-operation");
    expect(action).toBeTruthy();
    const opened = applyAndAssert(session, action!);
    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.waitingFor).toBe(1);

    const pass = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeTruthy();
    const result = applyResponse(session, pass!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("passed operation failed");
    expect(session.state.cards.find((card) => card.uid === source!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === moved!.uid)?.location).toBe("hand");
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chainPasses).toEqual([]);
    expect(session.state.waitingFor).toBe(1);
    expect(session.state.status).toBe("awaiting");
  });

  it("marks once-per-turn quick effects as used when chained", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const originalSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const playerQuickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(originalSource).toBeTruthy();
    expect(playerQuickSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    registerEffect(session, {
      id: "chain-starter",
      sourceUid: originalSource!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Starter resolved");
      },
    });
    registerEffect(session, {
      id: "player-quick",
      sourceUid: playerQuickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Player quick resolved");
      },
    });
    registerEffect(session, {
      id: "opponent-quick-once",
      sourceUid: opponentQuickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.log("Opponent quick resolved");
      },
    });

    const starter = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "chain-starter");
    expect(starter).toBeTruthy();
    expect(applyAndAssert(session, starter!).state.waitingFor).toBe(1);
    const opponentQuick = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "opponent-quick-once");
    expect(opponentQuick).toBeTruthy();
    const chained = applyAndAssert(session, opponentQuick!);

    expect(chained.ok).toBe(true);
    expect(chained.state.chain).toHaveLength(2);
    expect(chained.state.waitingFor).toBe(0);

    const pass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(pass).toBeTruthy();
    const resolved = applyAndAssert(session, pass!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.waitingFor).toBe(0);
    expect(resolved.state.log.filter((entry) => entry.detail === "Opponent quick resolved")).toHaveLength(1);
  });

  it("returns chain response priority to the last activating player after higher chain links", () => {
    const session = createDuel({ seed: 333, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const starterSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const playerQuickA = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const playerQuickB = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const opponentQuick = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(starterSource).toBeTruthy();
    expect(playerQuickA).toBeTruthy();
    expect(playerQuickB).toBeTruthy();
    expect(opponentQuick).toBeTruthy();

    registerEffect(session, {
      id: "priority-starter",
      sourceUid: starterSource!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Priority starter resolved");
      },
    });
    registerEffect(session, {
      id: "player-quick-a",
      sourceUid: playerQuickA!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Player quick A resolved");
      },
    });
    registerEffect(session, {
      id: "player-quick-b",
      sourceUid: playerQuickB!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Player quick B resolved");
      },
    });
    registerEffect(session, {
      id: "opponent-quick",
      sourceUid: opponentQuick!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.log("Opponent quick resolved");
      },
    });

    const starter = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "priority-starter");
    expect(starter).toBeTruthy();
    expect(applyAndAssert(session, starter!).state.waitingFor).toBe(1);
    const opponent = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "opponent-quick");
    expect(opponent).toBeTruthy();
    expect(applyAndAssert(session, opponent!).state.waitingFor).toBe(0);
    const playerA = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "player-quick-a");
    expect(playerA).toBeTruthy();
    const afterPlayerA = applyAndAssert(session, playerA!);

    expect(afterPlayerA.ok).toBe(true);
    expect(afterPlayerA.state.chain).toHaveLength(3);
    expect(afterPlayerA.state.waitingFor).toBe(0);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "player-quick-b")).toBe(true);
  });

  it("rejects stale chain pass responses after the chain resolves", () => {
    const session = createDuel({ seed: 96, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(source).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, {
      id: "stale-pass-source",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Stale pass source resolved");
      },
    });
    registerEffect(session, {
      id: "stale-pass-quick",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Stale pass quick resolved");
      },
    });

    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "stale-pass-source");
    expect(sourceAction).toBeTruthy();
    expect(applyAndAssert(session, sourceAction!).state.waitingFor).toBe(1);
    const stalePass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(stalePass).toBeTruthy();

    applyAndAssert(session, stalePass!);
    const replay = applyResponse(session, stalePass!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.state.actionWindowId).toBe(session.state.actionWindowId);
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.chain).toHaveLength(0);
    expect(session.state.log.filter((entry) => entry.detail === "Stale pass source resolved")).toHaveLength(1);
  });

  it("rejects stale chain pass responses captured before snapshot restore", () => {
    const session = createDuel({ seed: 98, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(source).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, {
      id: "restore-stale-pass-source",
      registryKey: "restore-stale-pass-source",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Restore stale pass source resolved");
      },
    });
    registerEffect(session, {
      id: "restore-stale-pass-quick",
      registryKey: "restore-stale-pass-quick",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Restore stale pass quick resolved");
      },
    });

    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-stale-pass-source");
    expect(sourceAction).toBeTruthy();
    expect(applyAndAssert(session, sourceAction!).state.waitingFor).toBe(1);
    const stalePass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(stalePass).toBeTruthy();

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-stale-pass-source": (effect) => ({
        ...effect,
        operation(ctx) {
          ctx.log("Restore stale pass source resolved");
        },
      }),
      "restore-stale-pass-quick": (effect) => ({
        ...effect,
        operation(ctx) {
          ctx.log("Restore stale pass quick resolved");
        },
      }),
    });
    const quick = getDuelLegalActions(restored, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-stale-pass-quick");
    expect(quick).toBeTruthy();
    const quickResult = applyAndAssert(restored, quick!);
    expect(restored.state.chain).toHaveLength(2);
    expect(restored.state.waitingFor).toBe(1);
    const replay = applyResponse(restored, stalePass!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.state.chain).toHaveLength(2);

    const currentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(currentPass).toBeTruthy();
    const currentPassResult = applyAndAssert(restored, currentPass!);
    expect(restored.state.chain).toHaveLength(0);
    expect(restored.state.log.filter((entry) => entry.detail === "Restore stale pass source resolved")).toHaveLength(1);
    expect(restored.state.log.filter((entry) => entry.detail === "Restore stale pass quick resolved")).toHaveLength(1);
  });

  it("rejects stale quick responses after their chain window closes", () => {
    const session = createDuel({ seed: 97, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, {
      id: "stale-quick-source",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Stale quick source resolved");
      },
    });
    registerEffect(session, {
      id: "stale-self-quick",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Stale self quick resolved");
      },
    });

    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "stale-quick-source");
    expect(sourceAction).toBeTruthy();
    const opened = applyAndAssert(session, sourceAction!);
    expect(opened.ok).toBe(true);
    expect(opened.state.waitingFor).toBe(0);
    const staleQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "stale-self-quick");
    const pass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(staleQuick).toBeTruthy();
    expect(pass).toBeTruthy();
    expect(staleQuick).toMatchObject({ windowId: queryPublicState(session).actionWindowId, windowKind: "chainResponse" });
    expect(pass).toMatchObject({ windowId: queryPublicState(session).actionWindowId, windowKind: "chainResponse" });
    applyAndAssert(session, pass!);

    const replay = applyResponse(session, staleQuick!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.state.actionWindowId).toBe(session.state.actionWindowId);
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.chain).toHaveLength(0);
    expect(session.state.log.filter((entry) => entry.detail === "Stale self quick resolved")).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "stale-self-quick")).toBe(true);
  });

  it("hides chain responses after restore when a pending chain effect is unavailable", () => {
    const session = createDuel({ seed: 99, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(source).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, {
      id: "missing-restored-chain-source",
      registryKey: "missing-restored-chain-source",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Missing restored chain source resolved");
      },
    });
    registerEffect(session, {
      id: "available-restored-chain-quick",
      registryKey: "available-restored-chain-quick",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Available restored chain quick resolved");
      },
    });

    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "missing-restored-chain-source");
    expect(sourceAction).toBeTruthy();
    expect(applyAndAssert(session, sourceAction!).state.waitingFor).toBe(1);
    expect(session.state.chain.map((link) => link.effectId)).toEqual(["missing-restored-chain-source"]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "available-restored-chain-quick": (effect) => ({
        ...effect,
        operation(ctx) {
          ctx.log("Available restored chain quick resolved");
        },
      }),
    });

    expect(restored.state.chain.map((link) => link.effectId)).toEqual(["missing-restored-chain-source"]);
    expect(restored.state.effects.map((effect) => effect.id)).toEqual(["available-restored-chain-quick"]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual([]);
    const forgedPass = applyResponse(restored, { type: "passChain", player: 1, label: "Pass" });
    expect(forgedPass.ok).toBe(false);
    expect(forgedPass.error).toContain("Response is not currently legal");
    expect(forgedPass.legalActionGroups).toEqual([]);
    expect(restored.state.chain.map((link) => link.effectId)).toEqual(["missing-restored-chain-source"]);
  });

  it("rejects stale quick responses captured before snapshot restore", () => {
    const session = createDuel({ seed: 99, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(quickSource).toBeTruthy();
    registerEffect(session, {
      id: "restore-stale-quick-source",
      registryKey: "restore-stale-quick-source",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Restore stale quick source resolved");
      },
    });
    registerEffect(session, {
      id: "restore-stale-self-quick",
      registryKey: "restore-stale-self-quick",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Restore stale self quick resolved");
      },
    });

    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-stale-quick-source");
    expect(sourceAction).toBeTruthy();
    expect(applyAndAssert(session, sourceAction!).state.waitingFor).toBe(0);
    const staleQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-stale-self-quick");
    expect(staleQuick).toBeTruthy();
    expect(staleQuick).toMatchObject({ windowId: queryPublicState(session).actionWindowId, windowKind: "chainResponse" });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-stale-quick-source": (effect) => ({
        ...effect,
        operation(ctx) {
          ctx.log("Restore stale quick source resolved");
        },
      }),
      "restore-stale-self-quick": (effect) => ({
        ...effect,
        operation(ctx) {
          ctx.log("Restore stale self quick resolved");
        },
      }),
    });
    const pass = getDuelLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(pass).toBeTruthy();
    expect(pass).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "chainResponse" });
    const passResult = applyAndAssert(restored, pass!);
    const replay = applyResponse(restored, staleQuick!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.state.chain).toHaveLength(0);
    expect(restored.state.log.filter((entry) => entry.detail === "Restore stale quick source resolved")).toHaveLength(1);
    expect(restored.state.log.some((entry) => entry.detail === "Restore stale self quick resolved")).toBe(false);
  });

});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
