import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("phase action restore", () => {
  it("restores phase change legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(action).toBeDefined();
    expect(action).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "open" });

    const staleResult = applyResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleResult.legalActions);
    expect(restored.state.phase).toBe("main1");
    expect(restored.state.log.some((entry) => entry.action === "phase" && entry.detail === "Moved to battle")).toBe(false);

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("battle");
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.state.log.some((entry) => entry.action === "phase" && entry.detail === "Moved to battle")).toBe(true);
    const staleReplay = applyResponse(restored, action!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    expect(staleReplay.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(staleReplay.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleReplay.legalActions);
  });

  it("restores end turn legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "endTurn");
    expect(action).toBeDefined();
    expect(action).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "open" });

    const staleResult = applyResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleResult.legalActions);
    expect(restored.state.turnPlayer).toBe(0);
    expect(restored.state.turn).toBe(1);
    expect(restored.state.phase).toBe("main1");
    expect(restored.state.log.some((entry) => entry.action === "turn" && entry.player === 1)).toBe(false);

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.turnPlayer).toBe(1);
    expect(result.state.turn).toBe(2);
    expect(result.state.phase).toBe("main1");
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.state.log.some((entry) => entry.action === "turn" && entry.player === 1)).toBe(true);
    const staleReplay = applyResponse(restored, action!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    expect(staleReplay.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(staleReplay.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleReplay.legalActions);
  });
});
