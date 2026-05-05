import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot counter numeric validation", () => {
  it("rejects impossible card counter snapshots before restore", () => {
    const session = createDuel({ seed: 243, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    negative.state.cards[0] = { ...negative.state.cards[0]!, counters: { 99: -1 } };
    fractional.state.cards[0] = { ...fractional.state.cards[0]!, counters: { 99: 0.5 } };

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.counters.99 must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.counters.99 must be a non-negative integer");
  });
});
