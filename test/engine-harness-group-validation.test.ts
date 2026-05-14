import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness legal action group validation", () => {
  it("rejects malformed legal action group trigger metadata containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed legal action group trigger metadata container fixture",
        options: { seed: 59, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          legalActionGroups: [
            {
              player: 0,
              triggerBucket: "trigger" as never,
              triggerOrderPrompt: "prompt" as never,
            },
          ],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed legal action group trigger metadata container fixture",
        message: "before fixture (edopro): Expected legal action group player=0 triggerBucket=\"trigger\" triggerOrderPrompt=\"prompt\" triggerBucket has malformed value trigger",
      },
      {
        fixture: "malformed legal action group trigger metadata container fixture",
        message: "before fixture (edopro): Expected legal action group player=0 triggerBucket=\"trigger\" triggerOrderPrompt=\"prompt\" triggerOrderPrompt has malformed value prompt",
      },
    ]);
  });

  it("rejects malformed legal action group action entries by index", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed legal action group action entry fixture",
        options: { seed: 60, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          legalActionGroups: [
            {
              player: 0,
              actions: [8 as never],
            },
          ],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed legal action group action entry fixture",
        message: "before fixture (edopro): Expected legal action group player=0 actions[0] has malformed value 8",
      },
    ]);
  });

  it("rejects unknown legal action group expectation keys", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "unknown legal action group expectation key fixture",
        options: { seed: 61, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          legalActionGroups: [{ player: 0, lable: "Turn" } as never],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "unknown legal action group expectation key fixture",
        message: "before fixture (edopro): Expected legal action group player=0 has malformed key lable",
      },
    ]);
  });
});
