import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot random result validation", () => {
  it("rejects impossible die result snapshots before restore", () => {
    const session = createDuel({ seed: 241, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const zero = serializeDuel(session);
    const high = serializeDuel(session);
    const fractional = serializeDuel(session);
    zero.state.lastDiceResults = [0];
    high.state.lastDiceResults = [7];
    fractional.state.lastDiceResults = [1.5];

    expect(() => restoreDuel(zero, createCardReader(cards))).toThrow("Malformed duel snapshot: state.lastDiceResults.0 must be a die result");
    expect(() => restoreDuel(high, createCardReader(cards))).toThrow("Malformed duel snapshot: state.lastDiceResults.0 must be a die result");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.lastDiceResults.0 must be a die result");
  });

  it("rejects impossible coin result snapshots before restore", () => {
    const session = createDuel({ seed: 242, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const high = serializeDuel(session);
    const fractional = serializeDuel(session);
    high.state.lastCoinResults = [2];
    fractional.state.lastCoinResults = [0.5];

    expect(() => restoreDuel(high, createCardReader(cards))).toThrow("Malformed duel snapshot: state.lastCoinResults.0 must be a coin result");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.lastCoinResults.0 must be a coin result");
  });
});
