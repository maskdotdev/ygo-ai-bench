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

  it("rejects impossible card counter bucket snapshots before restore", () => {
    const session = createDuel({ seed: 244, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    negative.state.cards[0] = { ...negative.state.cards[0]!, counterBuckets: { 99: { resetWhileNegated: -1 } } };
    fractional.state.cards[0] = { ...fractional.state.cards[0]!, counterBuckets: { 99: { permanent: 0.5 } } };

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.counterBuckets.99.resetWhileNegated must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.counterBuckets.99.permanent must be a non-negative integer");
  });

  it("rejects unknown card counter bucket snapshot fields before restore", () => {
    const session = createDuel({ seed: 245, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const stale = serializeDuel(session);
    stale.state.cards[0] = { ...stale.state.cards[0]!, counterBuckets: { 99: { permanent: 1, staleCounter: 1 } } } as never;

    expect(() => restoreDuel(stale, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.counterBuckets.99.staleCounter is not a known field");
  });
});
