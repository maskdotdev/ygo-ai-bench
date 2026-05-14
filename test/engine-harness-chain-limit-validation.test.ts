import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness chain limit validation", () => {
  it("rejects malformed chain limit expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed chain limit fixture",
        options: { seed: 62, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          chainLimits: [
            {
              registryKey: false,
              untilChainEnd: "yes",
              expiresAtChainLength: 0.5,
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
      { fixture: "malformed chain limit fixture", message: "before fixture (edopro): Expected chainLimits[0] has malformed key bogus" },
      { fixture: "malformed chain limit fixture", message: "before fixture (edopro): Expected chainLimits[0].registryKey has malformed value false" },
      { fixture: "malformed chain limit fixture", message: "before fixture (edopro): Expected chainLimits[0].untilChainEnd has malformed value yes" },
      { fixture: "malformed chain limit fixture", message: "before fixture (edopro): Expected chainLimits[0].expiresAtChainLength has malformed value 0.5" },
    ]);
  });

  it("rejects malformed chain limit expectation entries by index", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed chain limit entry fixture",
        options: { seed: 63, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          chainLimits: ["limit" as never],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed chain limit entry fixture", message: "before fixture (edopro): Expected chainLimits[0] has malformed value limit" },
    ]);
  });

  it("rejects malformed chain limit expectation containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed chain limit container fixture",
        options: { seed: 72, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          chainLimits: "limits" as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed chain limit container fixture", message: "before fixture (edopro): Expected chainLimits has malformed value limits" },
    ]);
  });
});
