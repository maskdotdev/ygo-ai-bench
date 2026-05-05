import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot log and flag numeric validation", () => {
  it("rejects impossible log step snapshots before restore", () => {
    const session = createDuel({ seed: 247, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const zero = serializeDuel(session);
    const fractional = serializeDuel(session);
    zero.state.log = [{ step: 0, action: "bad", detail: "zero step" }];
    fractional.state.log = [{ step: 1.5, action: "bad", detail: "fractional step" }];

    expect(() => restoreDuel(zero, createCardReader(cards))).toThrow("Malformed duel snapshot: state.log.0.step must be a positive integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.log.0.step must be a positive integer");
  });

  it("rejects impossible flag turn snapshots before restore", () => {
    const session = createDuel({ seed: 248, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    negative.state.flagEffects = [{ ownerType: "player", ownerId: "0", code: 1, reset: 0, property: 0, value: 1, turn: -1 }];
    fractional.state.flagEffects = [{ ownerType: "player", ownerId: "1", code: 1, reset: 0, property: 0, value: 1, turn: 0.5 }];

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.flagEffects.0.turn must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.flagEffects.0.turn must be a non-negative integer");
  });
});
