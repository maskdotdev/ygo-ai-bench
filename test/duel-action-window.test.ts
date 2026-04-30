import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, restoreDuel, serializeDuel, sendDuelCardToGraveyard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

function setupOneCardDuel(seed: number) {
  const session = createDuel({ seed, startingHandSize: 1, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100"] },
    1: { main: ["400"] },
  });
  startDuel(session);
  return session;
}

describe("duel action windows", () => {
  it("increments actionWindowId after successful responses", () => {
    const session = setupOneCardDuel(109);
    expect(session.state.actionWindowId).toBe(0);

    session.state.prompt = { id: "window-success", type: "selectYesNo", player: 0 };
    session.state.waitingFor = 0;
    const yes = getDuelLegalActions(session, 0).find((action) => action.type === "selectYesNo" && action.yes);
    expect(yes).toBeDefined();
    expect(yes?.windowId).toBe(0);
    expect(applyResponse(session, yes!).ok).toBe(true);

    expect(session.state.actionWindowId).toBe(1);
    const nextAction = getDuelLegalActions(session, 0)[0];
    expect(nextAction?.windowId).toBe(1);
  });

  it("does not increment actionWindowId after illegal responses", () => {
    const session = setupOneCardDuel(110);
    const staleResponse = { type: "passChain" as const, player: 0 as const, label: "Pass", windowId: 0 };
    const result = applyResponse(session, staleResponse);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Response is not currently legal");
    expect(session.state.actionWindowId).toBe(0);
  });

  it("restores actionWindowId after failed response rollback", () => {
    const session = createDuel({ seed: 111, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const moved = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeDefined();
    expect(moved).toBeDefined();
    registerEffect(session, {
      id: "window-rollback-failure",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, moved!.uid, ctx.player);
        throw new Error("window rollback failed");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "window-rollback-failure");
    expect(action).toBeDefined();
    expect(action?.windowId).toBe(0);
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("window rollback failed");
    expect(session.state.actionWindowId).toBe(0);
    expect(getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "window-rollback-failure")?.windowId).toBe(0);
  });

  it("preserves actionWindowId through snapshots and rejects stale pre-snapshot actions", () => {
    const session = setupOneCardDuel(112);
    session.state.prompt = { id: "window-snapshot", type: "selectOption", player: 0, options: [1], returnTo: 0 };
    session.state.waitingFor = 0;
    const staleOption = getDuelLegalActions(session, 0).find((action) => action.type === "selectOption");
    expect(staleOption).toBeDefined();
    expect(staleOption?.windowId).toBe(0);
    expect(applyResponse(session, staleOption!).ok).toBe(true);
    expect(session.state.actionWindowId).toBe(1);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.actionWindowId).toBe(1);
    const replay = applyResponse(restored, staleOption!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(restored.state.actionWindowId).toBe(1);
  });
});
