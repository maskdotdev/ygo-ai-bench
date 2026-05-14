import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness activity history validation", () => {
  it("rejects malformed activity history expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed activity history fixture",
        options: { seed: 64, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          activityHistory: [
            {
              player: 2,
              activity: 0.5,
              cardUid: false,
              effectId: 300,
              bogus: 1,
            },
          ] as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed activity history fixture", message: "before fixture (edopro): Expected activityHistory[0] has malformed key bogus" },
      { fixture: "malformed activity history fixture", message: "before fixture (edopro): Expected activityHistory[0].player has malformed player 2" },
      { fixture: "malformed activity history fixture", message: "before fixture (edopro): Expected activityHistory[0].activity has malformed value 0.5" },
      { fixture: "malformed activity history fixture", message: "before fixture (edopro): Expected activityHistory[0].cardUid has malformed value false" },
      { fixture: "malformed activity history fixture", message: "before fixture (edopro): Expected activityHistory[0].effectId has malformed value 300" },
    ]);
  });

  it("rejects malformed activity history expectation entries by index", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed activity history entry fixture",
        options: { seed: 65, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          activityHistory: ["activity" as never],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed activity history entry fixture", message: "before fixture (edopro): Expected activityHistory[0] has malformed value activity" },
    ]);
  });

  it("rejects malformed activity history expectation containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed activity history container fixture",
        options: { seed: 69, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          activityHistory: "activity" as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed activity history container fixture", message: "before fixture (edopro): Expected activityHistory has malformed value activity" },
    ]);
  });
});
