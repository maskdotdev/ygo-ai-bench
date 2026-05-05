import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot effect relation numeric validation", () => {
  it("rejects impossible effect relation id snapshots before restore", () => {
    const session = createDuel({ seed: 249, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    negative.state.cards[0] = { ...negative.state.cards[0]!, effectRelationIds: [-1] };
    fractional.state.cards[0] = { ...fractional.state.cards[0]!, effectRelationIds: [0.5] };

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.effectRelationIds.0 must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.effectRelationIds.0 must be a non-negative integer");
  });

  it("rejects duplicate effect relation id snapshots before restore", () => {
    const session = createDuel({ seed: 250, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const duplicate = serializeDuel(session);
    duplicate.state.cards[0] = { ...duplicate.state.cards[0]!, effectRelationIds: [101, 101] };

    expect(() => restoreDuel(duplicate, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.effectRelationIds must not contain duplicates");
  });
});
