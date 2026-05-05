import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot scalar numeric validation", () => {
  it("rejects impossible engine counter snapshots before restore", () => {
    const session = createDuel({ seed: 244, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const negativeWindow = serializeDuel(session);
    const fractionalTurn = serializeDuel(session);
    const fractionalRandom = serializeDuel(session);
    negativeWindow.state.actionWindowId = -1;
    fractionalTurn.state.turn = 1.5;
    fractionalRandom.state.randomCounter = 0.5;

    expect(() => restoreDuel(negativeWindow, createCardReader(cards))).toThrow("Malformed duel snapshot: state.actionWindowId must be a non-negative integer");
    expect(() => restoreDuel(fractionalTurn, createCardReader(cards))).toThrow("Malformed duel snapshot: state.turn must be a non-negative integer");
    expect(() => restoreDuel(fractionalRandom, createCardReader(cards))).toThrow("Malformed duel snapshot: state.randomCounter must be a non-negative integer");
  });
});
