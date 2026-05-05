import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel stale prompt responses", () => {
  it("rejects stale select-option responses after the prompt resolves", () => {
    const session = createDuel({ seed: 107, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    session.state.prompt = { id: "stale-option-prompt", type: "selectOption", player: 1, options: [1, 3], returnTo: 0 };
    session.state.waitingFor = 1;

    const staleOption = getDuelLegalActions(session, 1).find((action) => action.type === "selectOption" && action.option === 3);
    expect(staleOption).toBeDefined();
    expect(applyResponse(session, staleOption!).ok).toBe(true);
    const replay = applyResponse(session, staleOption!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.prompt).toBeUndefined();
    expect(session.state.waitingFor).toBe(0);
    expect(session.state.log.filter((entry) => entry.action === "selectOption" && entry.detail === "Selected option 3")).toHaveLength(1);
  });

  it("rejects stale yes-no responses after the prompt resolves", () => {
    const session = createDuel({ seed: 108, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    session.state.prompt = { id: "stale-yes-no-prompt", type: "selectYesNo", player: 0, description: 456, returnTo: 1 };
    session.state.waitingFor = 0;

    const staleNo = getDuelLegalActions(session, 0).find((action) => action.type === "selectYesNo" && !action.yes);
    expect(staleNo).toBeDefined();
    expect(applyResponse(session, staleNo!).ok).toBe(true);
    const replay = applyResponse(session, staleNo!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 1));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 1));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.prompt).toBeUndefined();
    expect(session.state.waitingFor).toBe(1);
    expect(session.state.log.filter((entry) => entry.action === "selectYesNo" && entry.detail === "Selected no")).toHaveLength(1);
  });

  it("rejects stale prompt responses captured before snapshot restore", () => {
    const session = createDuel({ seed: 109, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    session.state.prompt = { id: "restore-stale-option-prompt", type: "selectOption", player: 1, options: [2, 4], returnTo: 0 };
    session.state.waitingFor = 1;

    const staleOption = getDuelLegalActions(session, 1).find((action) => action.type === "selectOption" && action.option === 4);
    expect(staleOption).toBeDefined();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const restoredOption = getDuelLegalActions(restored, 1).find((action) => action.type === "selectOption" && action.option === 2);
    expect(restoredOption).toBeDefined();
    expect(restoredOption).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "prompt" });
    const optionResult = applyResponse(restored, restoredOption!);
    expect(optionResult.ok).toBe(true);
    expect(optionResult.legalActions).toEqual(getDuelLegalActions(restored, optionResult.state.waitingFor!));
    expect(optionResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, optionResult.state.waitingFor!));
    expect(optionResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(optionResult.legalActions);
    const replay = applyResponse(restored, staleOption!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.state.prompt).toBeUndefined();
    expect(restored.state.log.filter((entry) => entry.action === "selectOption" && entry.detail === "Selected option 2")).toHaveLength(1);
    expect(restored.state.log.some((entry) => entry.action === "selectOption" && entry.detail === "Selected option 4")).toBe(false);
  });

  it("rejects stale yes-no responses captured before snapshot restore", () => {
    const session = createDuel({ seed: 110, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    session.state.prompt = { id: "restore-stale-yes-no-prompt", type: "selectYesNo", player: 0, description: 789, returnTo: 1 };
    session.state.waitingFor = 0;

    const staleNo = getDuelLegalActions(session, 0).find((action) => action.type === "selectYesNo" && !action.yes);
    expect(staleNo).toBeDefined();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const restoredYes = getDuelLegalActions(restored, 0).find((action) => action.type === "selectYesNo" && action.yes);
    expect(restoredYes).toBeDefined();
    expect(restoredYes).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "prompt" });
    const yesResult = applyResponse(restored, restoredYes!);
    expect(yesResult.ok).toBe(true);
    expect(yesResult.legalActions).toEqual(getDuelLegalActions(restored, yesResult.state.waitingFor!));
    expect(yesResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, yesResult.state.waitingFor!));
    expect(yesResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(yesResult.legalActions);
    const replay = applyResponse(restored, staleNo!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.state.prompt).toBeUndefined();
    expect(restored.state.waitingFor).toBe(1);
    expect(restored.state.log.filter((entry) => entry.action === "selectYesNo" && entry.detail === "Selected yes")).toHaveLength(1);
    expect(restored.state.log.some((entry) => entry.action === "selectYesNo" && entry.detail === "Selected no")).toBe(false);
  });
});
