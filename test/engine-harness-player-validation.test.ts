import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness player validation", () => {
  it("rejects malformed legal action match players", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed legal action match player fixture",
      options: { seed: 34, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActions: [{ type: "changePhase", player: 2 as never, phase: "battle" }],
        absentLegalActions: [{ type: "changePhase", player: -1 as never, phase: "battle" }],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed legal action match player fixture",
        message: "before fixture (edopro): Expected legal action type=changePhase player=2 phase=battle has malformed player 2",
      },
      {
        fixture: "malformed legal action match player fixture",
        message: "before fixture (edopro): Expected no legal action type=changePhase player=-1 phase=battle has malformed player -1",
      },
    ]);
  });

  it("rejects malformed grouped legal action match players", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed grouped legal action match player fixture",
      options: { seed: 35, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActionGroups: [{ player: 2 as never, label: "Turn" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Turn",
            actions: [{ type: "changePhase", player: -1 as never, phase: "battle" }],
          },
        ],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed grouped legal action match player fixture",
        message: "before fixture (edopro): Expected legal action group player=2 label=Turn has malformed player 2",
      },
      {
        fixture: "malformed grouped legal action match player fixture",
        message: "before fixture (edopro): Expected no legal action group player=0 label=Turn action type=changePhase player=-1 phase=battle has malformed player -1",
      },
    ]);
  });

  it("rejects malformed legal action match window stamps", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed legal action match window fixture",
      options: { seed: 61, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActions: [{ type: "changePhase", player: 0, phase: "battle", windowId: Number.NaN }],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed legal action match window fixture",
        message: "before fixture (edopro): Expected legal action type=changePhase player=0 windowId=NaN phase=battle has malformed windowId",
      },
    ]);
  });
});
