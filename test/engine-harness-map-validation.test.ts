import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness map validation", () => {
  it("rejects malformed map expectation containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed map expectation fixture",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        lifePoints: "8000" as never,
        battleDamage: null as never,
        activityCounts: "summon" as never,
        legalActionCounts: ["0"] as never,
        legalActionGroupCounts: 1 as never,
        locations: { deck: "100" } as never,
        locationCounts: { hand: ["200"] } as never,
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed map expectation fixture",
        message: "before fixture (edopro): Expected lifePoints has malformed value 8000",
      },
      {
        fixture: "malformed map expectation fixture",
        message: "before fixture (edopro): Expected activityCounts has malformed value summon",
      },
      {
        fixture: "malformed map expectation fixture",
        message: "before fixture (edopro): Expected battleDamage has malformed value null",
      },
      {
        fixture: "malformed map expectation fixture",
        message: "before fixture (edopro): Expected legal action count has malformed value 0",
      },
      {
        fixture: "malformed map expectation fixture",
        message: "before fixture (edopro): Expected legal action group count has malformed value 1",
      },
      {
        fixture: "malformed map expectation fixture",
        message: "before fixture (edopro): Expected locations[deck] has malformed value 100",
      },
      {
        fixture: "malformed map expectation fixture",
        message: "before fixture (edopro): Expected locationCounts[hand] has malformed value 200",
      },
    ]);
  });
});
