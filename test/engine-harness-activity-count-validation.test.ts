import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness activity count validation", () => {
  it("rejects malformed activity count containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed activity count container fixture",
      options: { seed: 64, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        activityCounts: { 0: null, 1: ["attack"] } as never,
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed activity count container fixture",
        message: "before fixture (edopro): Expected player 0 activityCounts has malformed value null",
      },
      {
        fixture: "malformed activity count container fixture",
        message: "before fixture (edopro): Expected player 1 activityCounts has malformed value attack",
      },
    ]);
  });
});
