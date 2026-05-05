import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("duel snapshot reset numeric validation", () => {
  it("rejects impossible effect reset count snapshots before restore", () => {
    const session = createDuel({ seed: 239, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-reset-count",
      registryKey: "snapshot-reset-count",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      range: ["hand"],
      reset: { flags: 1, count: 1 },
      operation() {},
    });
    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    negative.state.effects[0] = { ...negative.state.effects[0]!, reset: { flags: 1, count: -1 } };
    fractional.state.effects[0] = { ...fractional.state.effects[0]!, reset: { flags: 1, count: 0.5 } };

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.reset.count must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.reset.count must be a non-negative integer");
  });

  it("rejects impossible flag reset count snapshots before restore", () => {
    const session = createDuel({ seed: 240, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    negative.state.flagEffects = [{ ownerType: "player", ownerId: "0", code: 1, reset: 1, resetCount: -1, property: 0, value: 1, turn: 1 }];
    fractional.state.flagEffects = [{ ownerType: "player", ownerId: "1", code: 1, reset: 1, resetCount: 0.5, property: 0, value: 1, turn: 1 }];

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.flagEffects.0.resetCount must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.flagEffects.0.resetCount must be a non-negative integer");
  });
});
