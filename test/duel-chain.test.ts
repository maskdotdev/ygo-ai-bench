import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  sendDuelCardToGraveyard,
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
    const result = applyResponse(session, effect!);

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
    const result = applyResponse(session, effect!);

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
    expect(applyResponse(session, starterAction!).ok).toBe(true);
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
    expect(applyResponse(session, secondAction!).ok).toBe(true);

    expect(session.state.effects.some((effect) => effect.id === "counted-reset-chain")).toBe(false);
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
    const opened = applyResponse(session, original!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.waitingFor).toBe(1);
    expect(opened.state.log.some((entry) => entry.detail === "Original operation resolved")).toBe(false);

    const response = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "quick-response");
    expect(response).toBeTruthy();
    const resolved = applyResponse(session, response!);
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
    const opened = applyResponse(session, action!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.chain[0]?.targetUids).toEqual([target!.uid]);
    expect(opened.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("hand");

    const response = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "target-response");
    expect(response).toBeTruthy();
    const resolved = applyResponse(session, response!);

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
    const opened = applyResponse(session, original!);
    expect(opened.state.chain).toHaveLength(1);

    const response = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "negating-response");
    expect(response).toBeTruthy();
    const resolved = applyResponse(session, response!);

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
    expect(applyResponse(session, original!).state.chain).toHaveLength(1);

    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeTruthy();
    const resolved = applyResponse(session, pass!);

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
    const opened = applyResponse(session, action!);
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
    expect(applyResponse(session, starter!).state.waitingFor).toBe(1);
    const opponentQuick = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "opponent-quick-once");
    expect(opponentQuick).toBeTruthy();
    const chained = applyResponse(session, opponentQuick!);

    expect(chained.ok).toBe(true);
    expect(chained.state.chain).toHaveLength(2);
    expect(chained.state.waitingFor).toBe(0);

    const pass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(pass).toBeTruthy();
    const resolved = applyResponse(session, pass!);

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.waitingFor).toBe(0);
    expect(resolved.state.log.filter((entry) => entry.detail === "Opponent quick resolved")).toHaveLength(1);
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
    expect(applyResponse(session, sourceAction!).state.waitingFor).toBe(1);
    const stalePass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(stalePass).toBeTruthy();

    expect(applyResponse(session, stalePass!).ok).toBe(true);
    const replay = applyResponse(session, stalePass!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(session.state.chain).toHaveLength(0);
    expect(session.state.log.filter((entry) => entry.detail === "Stale pass source resolved")).toHaveLength(1);
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
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok).toBe(true);
    expect(opened.state.waitingFor).toBe(0);
    const staleQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "stale-self-quick");
    const pass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(staleQuick).toBeTruthy();
    expect(pass).toBeTruthy();
    expect(applyResponse(session, pass!).ok).toBe(true);

    const replay = applyResponse(session, staleQuick!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(session.state.chain).toHaveLength(0);
    expect(session.state.log.filter((entry) => entry.detail === "Stale self quick resolved")).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "stale-self-quick")).toBe(true);
  });

  it("resets once-per-turn effect usage on a later turn", () => {
    const session = createDuel({ seed: 3, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "repeat-next-turn",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["monsterZone"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.log(`Resolved on turn ${ctx.duel.turn}`);
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === source!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);

    const firstActivation = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "repeat-next-turn");
    expect(firstActivation).toBeTruthy();
    expect(applyResponse(session, firstActivation!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "repeat-next-turn")).toBe(false);

    const playerEnd = getDuelLegalActions(session, 0).find((action) => action.type === "endTurn");
    expect(playerEnd).toBeTruthy();
    expect(applyResponse(session, playerEnd!).ok).toBe(true);
    const opponentEnd = getDuelLegalActions(session, 1).find((action) => action.type === "endTurn");
    expect(opponentEnd).toBeTruthy();
    expect(applyResponse(session, opponentEnd!).ok).toBe(true);

    expect(queryPublicState(session).turn).toBe(3);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "repeat-next-turn")).toBe(true);
  });
});
