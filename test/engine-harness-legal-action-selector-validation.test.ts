import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness legal action selector validation", () => {
  it("matches grouped legal action child expectations by action window tokens", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "forged token group child expectation fixture",
      options: { seed: 12, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActionGroups: [
          {
            player: 0,
            label: "Turn",
            count: 1,
            actions: [{ type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open", windowToken: "forged-window-token", count: 1 }],
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
        fixture: "forged token group child expectation fixture",
        message: "before fixture (edopro): Expected legal action group player=0 label=Turn matched 0, expected 1",
      },
    ]);
  });

  it("matches absent grouped legal action child expectations by action window tokens", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "forged token absent group child expectation fixture",
      options: { seed: 12, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Turn",
            actions: [{ type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open", windowToken: "forged-window-token" }],
          },
        ],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok, result.failures.map((failure) => failure.message).join("; ")).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("rejects malformed legal action selector fields", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed legal action selector fixture",
      options: { seed: 62, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActions: [{ type: "changePhase", player: 0, phase: "bogus" as never }],
        absentLegalActions: [{ type: "normalSummon", player: 0, location: "nowhere" as never }],
        legalActionGroups: [
          {
            player: 0,
            label: "Turn",
            actions: [{ type: "selectOption", player: 0, option: Number.NaN }],
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
        fixture: "malformed legal action selector fixture",
        message: "before fixture (edopro): Expected legal action type=changePhase player=0 phase=bogus has malformed phase",
      },
      {
        fixture: "malformed legal action selector fixture",
        message: "before fixture (edopro): Expected legal action group player=0 label=Turn action type=selectOption player=0 has malformed option",
      },
      {
        fixture: "malformed legal action selector fixture",
        message: "before fixture (edopro): Expected no legal action type=normalSummon player=0 location=nowhere has malformed location",
      },
    ]);
  });

  it("rejects empty prompt selector fields before matching", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "empty prompt selector fixture",
      options: { seed: 66, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActions: [{ type: "selectOption", player: 0, promptId: "" }],
        absentLegalActions: [{ type: "selectYesNo", player: 0, promptId: "prompt", labelIncludes: "" }],
        legalActionGroups: [
          {
            player: 0,
            label: "Prompt",
            actions: [{ type: "selectOption", player: 0, promptId: "prompt", labelIncludes: "" }],
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
        fixture: "empty prompt selector fixture",
        message: "before fixture (edopro): Expected legal action type=selectOption player=0 promptId= has malformed promptId",
      },
      {
        fixture: "empty prompt selector fixture",
        message: "before fixture (edopro): Expected legal action group player=0 label=Prompt action type=selectOption player=0 promptId=prompt labelIncludes= has malformed labelIncludes",
      },
      {
        fixture: "empty prompt selector fixture",
        message: "before fixture (edopro): Expected no legal action type=selectYesNo player=0 promptId=prompt labelIncludes= has malformed labelIncludes",
      },
    ]);
  });

  it("rejects malformed legal action group selector fields", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed legal action group selector fixture",
      options: { seed: 63, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActionGroups: [{ player: 0, key: 7 as never }],
        absentLegalActionGroups: [{ player: 0, label: false as never }, { player: 0, actions: "activate" as never }],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed legal action group selector fixture",
        message: "before fixture (edopro): Expected legal action group player=0 key=7 has malformed key 7",
      },
      {
        fixture: "malformed legal action group selector fixture",
        message: "before fixture (edopro): Expected no legal action group player=0 label=false has malformed label false",
      },
      {
        fixture: "malformed legal action group selector fixture",
        message: "before fixture (edopro): Expected no legal action group player=0 actions has malformed value activate",
      },
    ]);
  });

  it("rejects malformed legal action and group list entries", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed legal action list entry fixture",
      options: { seed: 64, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActions: [null as never],
        absentLegalActions: [false as never],
        legalActionGroups: [null as never],
        absentLegalActionGroups: ["group" as never],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed legal action list entry fixture",
        message: "before fixture (edopro): Expected legalActions[0] has malformed value null",
      },
      {
        fixture: "malformed legal action list entry fixture",
        message: "before fixture (edopro): Expected absentLegalActions[0] has malformed value false",
      },
      {
        fixture: "malformed legal action list entry fixture",
        message: "before fixture (edopro): Expected legalActionGroups[0] has malformed value null",
      },
      {
        fixture: "malformed legal action list entry fixture",
        message: "before fixture (edopro): Expected absentLegalActionGroups[0] has malformed value group",
      },
    ]);
  });

  it("rejects unknown legal action selector keys", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "unknown legal action selector key fixture",
      options: { seed: 65, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActions: [{ type: "normalSummon", player: 0, cod: "100" } as never],
        legalActionGroups: [
          {
            player: 0,
            label: "Summons",
            actions: [{ type: "normalSummon", player: 0, cod: "100" } as never],
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
        fixture: "unknown legal action selector key fixture",
        message: "before fixture (edopro): Expected legal action type=normalSummon player=0 has malformed key cod",
      },
      {
        fixture: "unknown legal action selector key fixture",
        message: "before fixture (edopro): Expected legal action group player=0 label=Summons action type=normalSummon player=0 has malformed key cod",
      },
    ]);
  });
});
