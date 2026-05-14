import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness log validation", () => {
  it("rejects malformed log expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed log fixture",
        options: { seed: 65, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          log: [
            {
              step: 0.5,
              action: false,
              player: 2,
              card: 300,
              detail: null,
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
      { fixture: "malformed log fixture", message: "before fixture (edopro): Expected log[0] has malformed key bogus" },
      { fixture: "malformed log fixture", message: "before fixture (edopro): Expected log[0].step has malformed value 0.5" },
      { fixture: "malformed log fixture", message: "before fixture (edopro): Expected log[0].action has malformed value false" },
      { fixture: "malformed log fixture", message: "before fixture (edopro): Expected log[0].player has malformed player 2" },
      { fixture: "malformed log fixture", message: "before fixture (edopro): Expected log[0].card has malformed value 300" },
      { fixture: "malformed log fixture", message: "before fixture (edopro): Expected log[0].detail has malformed value null" },
    ]);
  });

  it("rejects malformed log expectation containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed log container fixture",
        options: { seed: 65, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          log: { action: "draw" } as never,
        },
        responses: [],
        expected: {
          source: "edopro",
          log: ["draw"] as never,
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed log container fixture", message: "before fixture (edopro): Expected log has malformed value [object Object]" },
      { fixture: "malformed log container fixture", message: "final expected (edopro): Expected log[0] has malformed value draw" },
    ]);
  });
});
