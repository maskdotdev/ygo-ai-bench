import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
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
    applyAndAssert(session, summon!);
    const staleTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(staleTrigger).toBeTruthy();

    applyAndAssert(session, staleTrigger!);
    const replay = applyResponse(session, staleTrigger!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(queryPublicState(session).pendingTriggerBuckets).toEqual([]);
    expect(session.state.log.filter((entry) => entry.detail === "Stale activate trigger resolved")).toHaveLength(1);
  });

  it("rejects trigger activations with stale bucket metadata", () => {
    const session = createDuel({ seed: 116, startingHandSize: 2, cardReader: createCardReader(cards) });
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
      id: "stale-bucket-activate-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Stale bucket activate trigger should not resolve");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    applyAndAssert(session, summon!);
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    if (!trigger || trigger.type !== "activateTrigger") throw new Error("Expected activate trigger action");

    const forged = { ...trigger, triggerBucket: "opponentOptional" as const };
    const result = applyResponse(session, forged);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Response is not currently legal");
    expect(result.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(queryPublicState(session).pendingTriggerBuckets).toEqual([{ player: 0, triggerBucket: "turnOptional", triggerIds: session.state.pendingTriggers.map((trigger) => trigger.id) }]);
    expect(session.state.log.some((entry) => entry.detail === "Stale bucket activate trigger should not resolve")).toBe(false);
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
    applyAndAssert(session, summon!);
    const staleDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger");
    expect(staleDecline).toBeTruthy();

    applyAndAssert(session, staleDecline!);
    const replay = applyResponse(session, staleDecline!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(queryPublicState(session).pendingTriggerBuckets).toEqual([]);
    expect(session.state.log.filter((entry) => entry.action === "declineTrigger" && entry.detail === "stale-decline-trigger")).toHaveLength(1);
    expect(session.state.log.some((entry) => entry.detail === "Stale decline trigger should not resolve")).toBe(false);
  });

  it("rejects trigger declines with stale bucket metadata", () => {
    const session = createDuel({ seed: 117, startingHandSize: 2, cardReader: createCardReader(cards) });
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
      id: "stale-bucket-decline-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Stale bucket decline trigger should not resolve");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    applyAndAssert(session, summon!);
    const decline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger");
    expect(decline).toBeTruthy();
    if (!decline || decline.type !== "declineTrigger") throw new Error("Expected decline trigger action");

    const forged = { ...decline, triggerBucket: "opponentOptional" as const };
    const result = applyResponse(session, forged);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Response is not currently legal");
    expect(result.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(queryPublicState(session).pendingTriggerBuckets).toEqual([{ player: 0, triggerBucket: "turnOptional", triggerIds: session.state.pendingTriggers.map((trigger) => trigger.id) }]);
    expect(session.state.log.some((entry) => entry.action === "declineTrigger" && entry.detail === "stale-bucket-decline-trigger")).toBe(false);
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
    applyAndAssert(session, summon!);
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
    expect(second).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "triggerBucket" });
    applyAndAssert(restored, second!);
    const replay = applyResponse(restored, staleFirst!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-stale-first-trigger"]);
    expect(queryPublicState(restored).pendingTriggerBuckets).toEqual([{ player: 0, triggerBucket: "turnOptional", triggerIds: restored.state.pendingTriggers.map((trigger) => trigger.id) }]);
    const declineFirst = getDuelLegalActions(restored, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-stale-first-trigger");
    expect(declineFirst).toBeTruthy();
    expect(declineFirst).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "triggerBucket" });
    applyAndAssert(restored, declineFirst!);
    expect(queryPublicState(restored).pendingTriggerBuckets).toEqual([]);
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
    applyAndAssert(session, summon!);
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
    expect(declineSecond).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "triggerBucket" });
    applyAndAssert(restored, declineSecond!);
    const replay = applyResponse(restored, staleDeclineFirst!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-stale-first-decline"]);
    expect(queryPublicState(restored).pendingTriggerBuckets).toEqual([{ player: 0, triggerBucket: "turnOptional", triggerIds: restored.state.pendingTriggers.map((trigger) => trigger.id) }]);
    expect(restored.state.log.filter((entry) => entry.action === "declineTrigger" && entry.detail === "restore-stale-second-decline")).toHaveLength(1);
    expect(restored.state.log.some((entry) => entry.action === "declineTrigger" && entry.detail === "restore-stale-first-decline")).toBe(false);
    expect(restored.state.log.some((entry) => entry.detail === "Restore stale first decline should not resolve")).toBe(false);
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
