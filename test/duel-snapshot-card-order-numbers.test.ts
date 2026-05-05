import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot card order numeric validation", () => {
  it("rejects impossible card sequence snapshots before restore", () => {
    const session = createDuel({ seed: 245, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    negative.state.cards[0] = { ...negative.state.cards[0]!, sequence: -1 };
    fractional.state.cards[0] = { ...fractional.state.cards[0]!, sequence: 0.5 };

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.sequence must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.sequence must be a non-negative integer");
  });

  it("rejects impossible card previous sequence and turn counter snapshots before restore", () => {
    const session = createDuel({ seed: 246, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badPreviousSequence = serializeDuel(session);
    const badTurnId = serializeDuel(session);
    const badTurnCounter = serializeDuel(session);
    badPreviousSequence.state.cards[0] = { ...badPreviousSequence.state.cards[0]!, previousSequence: -1 };
    badTurnId.state.cards[0] = { ...badTurnId.state.cards[0]!, turnId: 1.5 };
    badTurnCounter.state.cards[0] = { ...badTurnCounter.state.cards[0]!, turnCounter: -1 };

    expect(() => restoreDuel(badPreviousSequence, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.previousSequence must be a non-negative integer");
    expect(() => restoreDuel(badTurnId, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.turnId must be a non-negative integer");
    expect(() => restoreDuel(badTurnCounter, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.turnCounter must be a non-negative integer");
  });
});
