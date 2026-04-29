import { describe, expect, it } from "vitest";
import {
  applyResponse,
  banishDuelCard,
  canMoveDuelCardToLocation,
  canSpecialSummonDuelCard,
  createDuel,
  destroyDuelCard,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  restoreDuel,
  serializeDuel,
  sendDuelCardToGraveyard,
  specialSummonDuelCard,
  startDuel,
  tributeSummonDuelCard,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards, findPublicCard, setupFailedMoveAfterFirstFixture } from "./full-duel-engine-fixtures.js";

describe("full duel engine API", () => {
  it("starts a deterministic two-player duel and exposes legal responses", () => {
    const session = createDuel({ seed: 7, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const state = queryPublicState(session);
    expect(state.status).toBe("awaiting");
    expect(state.turn).toBe(1);
    expect(state.phase).toBe("main1");
    expect(state.cards.filter((card) => card.controller === 0 && card.location === "hand")).toHaveLength(2);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "normalSummon")).toBe(true);
    expect(getDuelLegalActions(session, 1)).toEqual([]);
  });

  it("exposes pending prompts as legal responses and preserves them in snapshots", () => {
    const session = createDuel({ seed: 71, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    session.state.prompt = { id: "prompt-1", type: "selectOption", player: 1, options: [0, 2], returnTo: 0 };
    session.state.waitingFor = 1;

    expect(queryPublicState(session).prompt).toEqual({ id: "prompt-1", type: "selectOption", player: 1, options: [0, 2], returnTo: 0 });
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(queryPublicState(restored).prompt).toEqual({ id: "prompt-1", type: "selectOption", player: 1, options: [0, 2], returnTo: 0 });
    expect(getDuelLegalActions(restored, 0)).toEqual([]);

    const options = getDuelLegalActions(restored, 1);
    expect(options).toEqual([
      { type: "selectOption", player: 1, promptId: "prompt-1", option: 0, label: "Select option 0" },
      { type: "selectOption", player: 1, promptId: "prompt-1", option: 2, label: "Select option 2" },
    ]);
    const optionResult = applyResponse(restored, options[1]!);
    expect(optionResult.ok).toBe(true);
    expect(optionResult.state.prompt).toBeUndefined();
    expect(optionResult.state.waitingFor).toBe(0);
    expect(optionResult.state.log.some((entry) => entry.action === "selectOption" && entry.detail === "Selected option 2")).toBe(true);

    restored.state.prompt = { id: "prompt-2", type: "selectYesNo", player: 0, description: 123 };
    restored.state.waitingFor = 0;
    const no = getDuelLegalActions(restored, 0).find((action) => action.type === "selectYesNo" && !action.yes);
    expect(no).toEqual({ type: "selectYesNo", player: 0, promptId: "prompt-2", yes: false, label: "No" });
    const yesNoResult = applyResponse(restored, no!);
    expect(yesNoResult.ok).toBe(true);
    expect(yesNoResult.state.log.some((entry) => entry.action === "selectYesNo" && entry.detail === "Selected no")).toBe(true);
  });

  it("applies legal responses and preserves zone invariants through serialization", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon");
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "normalSummon")).toHaveLength(0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const publicState = queryPublicState(restored);
    expect(publicState.cards.filter((card) => card.location === "monsterZone" && card.controller === 0)).toHaveLength(1);
    expect(publicState.cards.map((card) => card.uid)).toHaveLength(new Set(publicState.cards.map((card) => card.uid)).size);
  });

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

  it("exposes trigger effects as pending legal responses after a normal summon", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();

    registerEffect(session, {
      id: "on-normal-summon",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log(`Saw ${ctx.eventCard?.name ?? "a card"} Normal Summoned`);
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    const summonResult = applyResponse(session, summon!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.pendingTriggers).toHaveLength(1);
    expect(summonResult.state.cards.find((card) => card.uid === triggerSource!.uid)?.location).toBe("hand");
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    const triggerResult = applyResponse(session, trigger!);

    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.state.pendingTriggers).toHaveLength(0);
    expect(triggerResult.state.cards.find((card) => card.uid === triggerSource!.uid)?.location).toBe("graveyard");
    expect(triggerResult.state.log.some((entry) => entry.action === "trigger" && entry.detail === "on-normal-summon")).toBe(true);
    expect(triggerResult.state.log.some((entry) => entry.detail.includes("Normal Summoned"))).toBe(true);
  });

  it("lets quick effects respond to trigger activations", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    expect(quickSource).toBeTruthy();

    registerEffect(session, {
      id: "chainable-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Trigger saw ${ctx.eventCard?.name ?? "missing card"}`);
      },
    });
    registerEffect(session, {
      id: "trigger-response",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Quick response to trigger resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).state.pendingTriggers).toHaveLength(1);
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "chainable-trigger");
    expect(trigger).toBeTruthy();
    const opened = applyResponse(session, trigger!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.pendingTriggers).toHaveLength(0);
    expect(opened.state.waitingFor).toBe(1);
    expect(opened.state.log.some((entry) => entry.detail.includes("Trigger saw"))).toBe(false);

    const response = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "trigger-response");
    expect(response).toBeTruthy();
    const resolved = applyResponse(session, response!);
    const quickLog = resolved.state.log.find((entry) => entry.detail === "Quick response to trigger resolved");
    const triggerLog = resolved.state.log.find((entry) => entry.detail.includes("Trigger saw Normal Test Monster"));

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(quickLog).toBeTruthy();
    expect(triggerLog).toBeTruthy();
    expect(quickLog!.step).toBeLessThan(triggerLog!.step);
  });

  it("allows optional trigger effects to be declined", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();

    registerEffect(session, {
      id: "optional-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("Declined effect should not resolve");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);

    const decline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger");
    expect(decline).toBeTruthy();
    const result = applyResponse(session, decline!);

    expect(result.ok).toBe(true);
    expect(result.state.pendingTriggers).toHaveLength(0);
    expect(result.state.cards.find((card) => card.uid === triggerSource!.uid)?.location).toBe("hand");
    expect(result.state.log.some((entry) => entry.detail.includes("Declined effect should not resolve"))).toBe(false);
    expect(result.state.log.some((entry) => entry.action === "declineTrigger" && entry.detail === "optional-trigger")).toBe(true);
  });

  it("lets a player choose the order of multiple pending triggers", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const publicState = queryPublicState(session);
    const summoned = publicState.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstSource = publicState.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondSource = publicState.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(firstSource).toBeTruthy();
    expect(secondSource).toBeTruthy();

    registerEffect(session, {
      id: "first-trigger",
      sourceUid: firstSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("First trigger resolved");
      },
    });
    registerEffect(session, {
      id: "second-trigger",
      sourceUid: secondSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("Second trigger resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    const summonResult = applyResponse(session, summon!);
    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.pendingTriggers).toHaveLength(2);

    const second = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "second-trigger");
    expect(second).toBeTruthy();
    const secondResult = applyResponse(session, second!);
    expect(secondResult.ok).toBe(true);
    expect(secondResult.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["first-trigger"]);
    expect(secondResult.state.cards.find((card) => card.uid === secondSource!.uid)?.location).toBe("graveyard");
    expect(secondResult.state.cards.find((card) => card.uid === firstSource!.uid)?.location).toBe("hand");
  });

  it("collects phase and turn-start trigger effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const phaseSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(phaseSource).toBeTruthy();
    expect(turnSource).toBeTruthy();

    registerEffect(session, {
      id: "on-phase-change",
      sourceUid: phaseSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "phaseChanged",
      range: ["monsterZone"],
      operation(ctx) {
        ctx.log(`Observed ${ctx.eventName ?? "missing event"}`);
      },
    });
    registerEffect(session, {
      id: "on-turn-start",
      sourceUid: turnSource!.uid,
      controller: 1,
      event: "trigger",
      triggerEvent: "turnStarted",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Observed ${ctx.eventName ?? "missing event"}`);
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === phaseSource!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const battlePhase = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase).toBeTruthy();
    const phaseResult = applyResponse(session, battlePhase!);

    expect(phaseResult.ok).toBe(true);
    expect(phaseResult.state.pendingTriggers).toHaveLength(1);
    expect(phaseResult.state.pendingTriggers[0]).toMatchObject({ eventName: "phaseChanged", effectId: "on-phase-change" });
    expect(phaseResult.state.pendingTriggers[0]?.eventCardUid).toBeUndefined();
    const phaseTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "on-phase-change");
    expect(phaseTrigger).toBeTruthy();
    expect(applyResponse(session, phaseTrigger!).ok).toBe(true);

    const endTurn = getDuelLegalActions(session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeTruthy();
    const turnResult = applyResponse(session, endTurn!);

    expect(turnResult.ok).toBe(true);
    expect(turnResult.state.turn).toBe(2);
    expect(turnResult.state.pendingTriggers).toHaveLength(1);
    expect(turnResult.state.pendingTriggers[0]).toMatchObject({ player: 1, eventName: "turnStarted", effectId: "on-turn-start" });
  });

  it("collects trigger effects after a special summon operation", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(source).toBeTruthy();
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();

    registerEffect(session, {
      id: "summon-from-hand",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        specialSummonDuelCard(ctx.duel, summoned!.uid, ctx.player);
      },
    });
    registerEffect(session, {
      id: "on-special-summon",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Saw ${ctx.eventCard?.name ?? "missing card"} Special Summoned`);
      },
    });

    const activation = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "summon-from-hand");
    expect(activation).toBeTruthy();
    const activationResult = applyResponse(session, activation!);

    expect(activationResult.ok).toBe(true);
    expect(activationResult.state.cards.find((card) => card.uid === summoned!.uid)?.location).toBe("monsterZone");
    expect(activationResult.state.pendingTriggers).toHaveLength(1);
    expect(activationResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: summoned!.uid });
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "on-special-summon");
    expect(trigger).toBeTruthy();
    const triggerResult = applyResponse(session, trigger!);

    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.state.log.some((entry) => entry.detail.includes("Second Monster Special Summoned"))).toBe(true);
  });

  it("collects trigger effects after a card is sent to the graveyard", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const sent = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(source).toBeTruthy();
    expect(sent).toBeTruthy();
    expect(triggerSource).toBeTruthy();

    registerEffect(session, {
      id: "send-card",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, sent!.uid, ctx.player);
      },
    });
    registerEffect(session, {
      id: "on-sent",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "sentToGraveyard",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Saw ${ctx.eventCard?.name ?? "missing card"} sent`);
      },
    });

    const activation = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "send-card");
    expect(activation).toBeTruthy();
    const activationResult = applyResponse(session, activation!);

    expect(activationResult.ok).toBe(true);
    expect(activationResult.state.cards.find((card) => card.uid === sent!.uid)?.location).toBe("graveyard");
    expect(activationResult.state.pendingTriggers).toHaveLength(1);
    expect(activationResult.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToGraveyard", eventCardUid: sent!.uid });
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "on-sent");
    expect(trigger).toBeTruthy();
    const triggerResult = applyResponse(session, trigger!);

    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.state.log.some((entry) => entry.detail.includes("Second Monster sent"))).toBe(true);
  });

  it("moves cards through destroy and banish primitives", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const destroyed = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const banished = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(destroyed).toBeTruthy();
    expect(banished).toBeTruthy();

    destroyDuelCard(session.state, destroyed!.uid, 0);
    banishDuelCard(session.state, banished!.uid, 0);
    const state = queryPublicState(session);

    expect(state.cards.find((card) => card.uid === destroyed!.uid)?.location).toBe("graveyard");
    expect(state.cards.find((card) => card.uid === banished!.uid)?.location).toBe("banished");
    expect(state.log.some((entry) => entry.action === "destroy" && entry.card === "Normal Test Monster")).toBe(true);
    expect(state.log.some((entry) => entry.action === "banish" && entry.card === "Second Monster")).toBe(true);
    expect(canMoveDuelCardToLocation(session.state, destroyed!.uid, "graveyard")).toBe(false);
    expect(canMoveDuelCardToLocation(session.state, banished!.uid, "banished")).toBe(false);
    expect(() => sendDuelCardToGraveyard(session.state, destroyed!.uid, 0)).toThrow("cannot move to graveyard");
    expect(() => banishDuelCard(session.state, banished!.uid, 0)).toThrow("cannot move to banished");
  });

  it("applies destroy replacement effects before moving the destroyed card", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const threatened = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const replacement = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(threatened).toBeTruthy();
    expect(replacement).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "destroy-replace",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 50,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      target(ctx) {
        ctx.setTargets([replacement!.uid]);
        return true;
      },
      operation(ctx) {
        const [selected] = ctx.getTargets();
        if (selected) sendDuelCardToGraveyard(ctx.duel, selected.uid, ctx.player);
      },
    });

    destroyDuelCard(session.state, threatened!.uid, 0);
    const state = queryPublicState(session);

    expect(state.cards.find((card) => card.uid === threatened!.uid)?.location).toBe("hand");
    expect(state.cards.find((card) => card.uid === replacement!.uid)?.location).toBe("graveyard");
    expect(state.log.some((entry) => entry.action === "destroyReplace" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("applies release replacement effects before moving the released card", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const threatened = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const replacement = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(threatened).toBeTruthy();
    expect(replacement).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "release-replace",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 51,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      target(ctx) {
        ctx.setTargets([replacement!.uid]);
        return true;
      },
      operation(ctx) {
        const [selected] = ctx.getTargets();
        if (selected) sendDuelCardToGraveyard(ctx.duel, selected.uid, ctx.player, duelReason.release | duelReason.replace);
      },
    });

    sendDuelCardToGraveyard(session.state, threatened!.uid, 0, duelReason.release | duelReason.cost);
    const state = queryPublicState(session);

    expect(state.cards.find((card) => card.uid === threatened!.uid)?.location).toBe("hand");
    expect(state.cards.find((card) => card.uid === replacement!.uid)?.location).toBe("graveyard");
    expect(state.log.some((entry) => entry.action === "releaseReplace" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("blocks non-summon releases with unreleasable effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const threatened = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(threatened).toBeTruthy();

    registerEffect(session, {
      id: "unreleasable-nonsummon",
      sourceUid: threatened!.uid,
      controller: 0,
      event: "continuous",
      code: 44,
      range: ["hand"],
      operation() {},
    });

    expect(() => sendDuelCardToGraveyard(session.state, threatened!.uid, 0, duelReason.release | duelReason.cost)).toThrow("cannot be released");
    expect(session.state.cards.find((card) => card.uid === threatened!.uid)?.location).toBe("hand");
  });

  it("applies send replacement effects before sending a card to the graveyard", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const threatened = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const replacement = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(threatened).toBeTruthy();
    expect(replacement).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "send-replace",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 52,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      target(ctx) {
        ctx.setTargets([replacement!.uid]);
        return true;
      },
      operation(ctx) {
        const [selected] = ctx.getTargets();
        if (selected) sendDuelCardToGraveyard(ctx.duel, selected.uid, ctx.player, duelReason.effect | duelReason.replace);
      },
    });

    sendDuelCardToGraveyard(session.state, threatened!.uid, 0, duelReason.effect);
    const state = queryPublicState(session);

    expect(state.cards.find((card) => card.uid === threatened!.uid)?.location).toBe("hand");
    expect(state.cards.find((card) => card.uid === replacement!.uid)?.location).toBe("graveyard");
    expect(state.log.some((entry) => entry.action === "sendReplace" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("prevents moves with continuous cannot-move effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const graveBlocked = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const banishBlocked = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(graveBlocked).toBeTruthy();
    expect(banishBlocked).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "cannot-grave",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 68,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      operation() {},
    });
    registerEffect(session, {
      id: "cannot-banish",
      sourceUid: banishBlocked!.uid,
      controller: 0,
      event: "continuous",
      code: 67,
      range: ["hand"],
      operation() {},
    });

    expect(canMoveDuelCardToLocation(session.state, graveBlocked!.uid, "graveyard")).toBe(false);
    expect(canMoveDuelCardToLocation(session.state, banishBlocked!.uid, "banished")).toBe(false);
    expect(() => sendDuelCardToGraveyard(session.state, graveBlocked!.uid, 0)).toThrow("cannot move to graveyard");
    expect(() => banishDuelCard(session.state, banishBlocked!.uid, 0)).toThrow("cannot move to banished");
  });

  it("prevents effect destruction with indestructible effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const protectedCard = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(protectedCard).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "effect-indestructible",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 41,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      operation() {},
    });

    destroyDuelCard(session.state, protectedCard!.uid, 0);

    expect(queryPublicState(session).cards.find((card) => card.uid === protectedCard!.uid)?.location).toBe("hand");
    expect(queryPublicState(session).log.some((entry) => entry.action === "destroyPrevented" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("consumes counted indestructible effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const protectedCard = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(protectedCard).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "counted-indestructible",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 47,
      value: 1,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      operation() {},
    });

    destroyDuelCard(session.state, protectedCard!.uid, 0);
    expect(queryPublicState(session).cards.find((card) => card.uid === protectedCard!.uid)?.location).toBe("hand");

    destroyDuelCard(session.state, protectedCard!.uid, 0);
    expect(queryPublicState(session).cards.find((card) => card.uid === protectedCard!.uid)?.location).toBe("graveyard");
  });

  it("moves pendulum monsters to the extra deck face-up", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["350", "100"], extra: ["980"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const pendulum = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "350");
    const normal = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const extra = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    expect(pendulum).toBeTruthy();
    expect(normal).toBeTruthy();
    expect(extra).toBeTruthy();

    moveDuelCard(session.state, pendulum!.uid, "monsterZone", 0);
    moveDuelCard(session.state, pendulum!.uid, "extraDeck", 0);
    moveDuelCard(session.state, extra!.uid, "graveyard", 0);
    moveDuelCard(session.state, extra!.uid, "extraDeck", 0);

    const state = queryPublicState(session);
    expect(canMoveDuelCardToLocation(session.state, normal!.uid, "extraDeck")).toBe(false);
    expect(state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "extraDeck", faceUp: true, position: "faceDown" });
    expect(state.cards.find((card) => card.uid === extra!.uid)).toMatchObject({ location: "extraDeck", faceUp: false, position: "faceDown" });
  });

  it("special summons face-up pendulum monsters from the extra deck", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["350"], extra: ["980"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const pendulum = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "350");
    const extra = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    expect(pendulum).toBeTruthy();
    expect(extra).toBeTruthy();
    moveDuelCard(session.state, pendulum!.uid, "extraDeck", 0);

    expect(canSpecialSummonDuelCard(session.state, pendulum!.uid, 0)).toBe(true);
    expect(canSpecialSummonDuelCard(session.state, extra!.uid, 0)).toBe(false);
    expect(() => specialSummonDuelCard(session.state, extra!.uid, 0)).toThrow("cannot be Special Summoned");
    const summoned = specialSummonDuelCard(session.state, pendulum!.uid, 0);

    expect(summoned).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack", summonType: "special" });
    expect(session.state.log.some((entry) => entry.action === "specialSummon" && entry.card === "Pendulum Test Monster")).toBe(true);
  });

  it("hides normal summon actions when the monster zone is full", () => {
    const session = createDuel({ seed: 1, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "300", "300", "300", "500"] },
      1: { main: ["400", "400", "400", "400", "400", "400"] },
    });
    startDuel(session);

    const handMonsters = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster");
    for (const card of handMonsters.slice(0, 5)) moveDuelCard(session.state, card.uid, "monsterZone", 0);

    const legal = getDuelLegalActions(session, 0);
    expect(legal.some((action) => action.type === "normalSummon")).toBe(false);
    expect(() => specialSummonDuelCard(session.state, handMonsters[5]!.uid, 0)).toThrow("monsterZone is full");
  });

  it("tribute summons a level 5 or 6 monster with one tribute", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["600", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "600");
    const tribute = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tributeMonster).toBeTruthy();
    expect(tribute).toBeTruthy();
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((action) => action.type === "normalSummon" && action.uid === tributeMonster!.uid)).toBe(false);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "tributeSummon" && candidate.uid === tributeMonster!.uid && candidate.tributeUids.includes(tribute!.uid));
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === tribute!.uid)?.location).toBe("graveyard");
    expect(result.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("monsterZone");
    expect(result.state.players[0].normalSummonAvailable).toBe(false);
    expect(result.state.log.some((entry) => entry.action === "release" && entry.card === "Normal Test Monster")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "tributeSummon" && entry.card === "One Tribute Monster")).toBe(true);
  });

  it("applies graveyard redirects to tribute summon releases", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["600", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "600");
    const tribute = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tributeMonster).toBeTruthy();
    expect(tribute).toBeTruthy();
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);

    registerEffect(session, {
      id: "tribute-grave-redirect",
      sourceUid: tribute!.uid,
      controller: 0,
      event: "continuous",
      code: 63,
      range: ["monsterZone"],
      operation() {},
    });

    tributeSummonDuelCard(session.state, 0, tributeMonster!.uid, [tribute!.uid]);

    const released = session.state.cards.find((card) => card.uid === tribute!.uid);
    expect(released?.location).toBe("banished");
    expect(released?.reason && (released.reason & duelReason.release)).toBe(duelReason.release);
    expect(released?.reason && (released.reason & duelReason.redirect)).toBe(duelReason.redirect);
    expect(session.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("monsterZone");
  });

  it("blocks tribute summons with unreleasable summon materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["600", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "600");
    const tribute = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tributeMonster).toBeTruthy();
    expect(tribute).toBeTruthy();
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);

    registerEffect(session, {
      id: "unreleasable-summon",
      sourceUid: tribute!.uid,
      controller: 0,
      event: "continuous",
      code: 43,
      range: ["monsterZone"],
      operation() {},
    });

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "tributeSummon" && candidate.uid === tributeMonster!.uid)).toBe(false);
    expect(() => tributeSummonDuelCard(session.state, 0, tributeMonster!.uid, [tribute!.uid])).toThrow("cannot be released");
    expect(session.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === tribute!.uid)?.location).toBe("monsterZone");
  });

  it("tribute summons a level 7 or higher monster with two tributes even from a full monster zone", () => {
    const session = createDuel({ seed: 1, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["700", "100", "300", "300", "300", "500"] },
      1: { main: ["400", "400", "400", "400", "400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "700");
    const tributes = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster" && card.uid !== tributeMonster!.uid);
    expect(tributeMonster).toBeTruthy();
    expect(tributes).toHaveLength(5);
    for (const card of tributes) moveDuelCard(session.state, card.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "tributeSummon" && candidate.uid === tributeMonster!.uid && candidate.tributeUids.length === 2);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("tributeSummon");
    if (!action || action.type !== "tributeSummon") throw new Error("Expected tribute summon action");
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("monsterZone");
    expect(action.tributeUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone")).toHaveLength(4);
    expect(() => tributeSummonDuelCard(session.state, 0, tributeMonster!.uid, action.tributeUids)).toThrow("not in hand");
  });

});
