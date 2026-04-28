import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createCardReader,
  createDuel,
  getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  restoreDuel,
  serializeDuel,
  sendDuelCardToGraveyard,
  specialSummonDuelCard,
  startDuel,
} from "../src/engine/index.js";
import type { DuelCardData } from "../src/engine/index.js";

const cards: DuelCardData[] = [
  { code: "100", name: "Normal Test Monster", kind: "monster" },
  { code: "200", name: "Test Spell", kind: "spell" },
  { code: "300", name: "Second Monster", kind: "monster" },
  { code: "400", name: "Opponent Monster", kind: "monster" },
  { code: "500", name: "Third Monster", kind: "monster" },
];

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
});
