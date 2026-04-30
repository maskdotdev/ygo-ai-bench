import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, startDuel } from "#duel/core.js";
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
});
