import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
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
    expect(session.state.prompt).toBeUndefined();
    expect(session.state.waitingFor).toBe(1);
    expect(session.state.log.filter((entry) => entry.action === "selectYesNo" && entry.detail === "Selected no")).toHaveLength(1);
  });
});
