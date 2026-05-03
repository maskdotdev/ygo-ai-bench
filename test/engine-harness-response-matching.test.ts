import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness response matching", () => {
  it("matches concrete special summon procedure responses by effect id", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "special summon procedure effect-id response fixture",
      options: { seed: 5, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        effects: [
          {
            id: "available-procedure",
            player: 0,
            code: "100",
            event: "summonProcedure",
            range: ["hand"],
          },
        ],
      },
      responses: [
        makeScriptedStep({
          type: "specialSummonProcedure",
          player: 0,
          uid: "p0-deck-100-0",
          effectId: "missing-procedure",
          label: "Special Summon",
        }),
      ],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "special summon procedure effect-id response fixture",
        message: "No legal response matched type=specialSummonProcedure player=0 uid=p0-deck-100-0 effectId=missing-procedure",
      },
    ]);
  });

  it("matches concrete responses by action window stamps", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "stale stamped concrete response fixture",
      options: { seed: 6, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      responses: [
        makeScriptedStep({
          type: "changePhase",
          player: 0,
          phase: "battle",
          label: "Battle Phase",
          windowId: 1,
          windowKind: "open",
        }),
      ],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "stale stamped concrete response fixture",
        message: "No legal response matched type=changePhase player=0 windowId=1 phase=battle",
      },
    ]);
  });
});
