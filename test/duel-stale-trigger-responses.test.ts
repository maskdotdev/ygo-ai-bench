import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel stale trigger responses", () => {
  it("rejects stale trigger activations after the trigger is consumed", () => {
    const session = createDuel({ seed: 103, startingHandSize: 2, cardReader: createCardReader(cards) });
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
      id: "stale-activate-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Stale activate trigger resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const staleTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(staleTrigger).toBeTruthy();

    expect(applyResponse(session, staleTrigger!).ok).toBe(true);
    const replay = applyResponse(session, staleTrigger!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(session.state.log.filter((entry) => entry.detail === "Stale activate trigger resolved")).toHaveLength(1);
  });

  it("rejects stale trigger declines after the trigger is consumed", () => {
    const session = createDuel({ seed: 104, startingHandSize: 2, cardReader: createCardReader(cards) });
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
      id: "stale-decline-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Stale decline trigger should not resolve");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const staleDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger");
    expect(staleDecline).toBeTruthy();

    expect(applyResponse(session, staleDecline!).ok).toBe(true);
    const replay = applyResponse(session, staleDecline!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(session.state.log.filter((entry) => entry.action === "declineTrigger" && entry.detail === "stale-decline-trigger")).toHaveLength(1);
    expect(session.state.log.some((entry) => entry.detail === "Stale decline trigger should not resolve")).toBe(false);
  });

  it("rejects stale trigger activations captured before snapshot restore", () => {
    const session = createDuel({ seed: 111, startingHandSize: 3, cardReader: createCardReader(cards) });
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
      id: "restore-stale-first-trigger",
      registryKey: "restore-stale-first-trigger",
      sourceUid: firstSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Restore stale first trigger resolved");
      },
    });
    registerEffect(session, {
      id: "restore-stale-second-trigger",
      registryKey: "restore-stale-second-trigger",
      sourceUid: secondSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Restore stale second trigger resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const staleFirst = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-stale-first-trigger");
    expect(staleFirst).toBeTruthy();

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-stale-first-trigger": (effect) => ({
        ...effect,
        operation(ctx) {
          ctx.log("Restore stale first trigger resolved");
        },
      }),
      "restore-stale-second-trigger": (effect) => ({
        ...effect,
        operation(ctx) {
          ctx.log("Restore stale second trigger resolved");
        },
      }),
    });
    const second = getDuelLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-stale-second-trigger");
    expect(second).toBeTruthy();
    expect(applyResponse(restored, second!).ok).toBe(true);
    const replay = applyResponse(restored, staleFirst!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(restored.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-stale-first-trigger"]);
    expect(restored.state.log.some((entry) => entry.detail === "Restore stale second trigger resolved")).toBe(true);
    expect(restored.state.log.some((entry) => entry.detail === "Restore stale first trigger resolved")).toBe(false);
  });

  it("rejects stale trigger declines captured before snapshot restore", () => {
    const session = createDuel({ seed: 112, startingHandSize: 3, cardReader: createCardReader(cards) });
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
      id: "restore-stale-first-decline",
      registryKey: "restore-stale-first-decline",
      sourceUid: firstSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Restore stale first decline should not resolve");
      },
    });
    registerEffect(session, {
      id: "restore-stale-second-decline",
      registryKey: "restore-stale-second-decline",
      sourceUid: secondSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Restore stale second decline resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const staleDeclineFirst = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-stale-first-decline");
    expect(staleDeclineFirst).toBeTruthy();

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-stale-first-decline": (effect) => ({
        ...effect,
        operation(ctx) {
          ctx.log("Restore stale first decline should not resolve");
        },
      }),
      "restore-stale-second-decline": (effect) => ({
        ...effect,
        operation(ctx) {
          ctx.log("Restore stale second decline resolved");
        },
      }),
    });
    const declineSecond = getDuelLegalActions(restored, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-stale-second-decline");
    expect(declineSecond).toBeTruthy();
    expect(applyResponse(restored, declineSecond!).ok).toBe(true);
    const replay = applyResponse(restored, staleDeclineFirst!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(restored.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-stale-first-decline"]);
    expect(restored.state.log.filter((entry) => entry.action === "declineTrigger" && entry.detail === "restore-stale-second-decline")).toHaveLength(1);
    expect(restored.state.log.some((entry) => entry.action === "declineTrigger" && entry.detail === "restore-stale-first-decline")).toBe(false);
    expect(restored.state.log.some((entry) => entry.detail === "Restore stale first decline should not resolve")).toBe(false);
  });
});
