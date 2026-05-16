import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";

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
        message: "No legal response matched type=changePhase player=0 windowId=1 windowKind=open phase=battle",
      },
    ]);
  });

  it("rejects otherwise matching concrete responses without full action window stamps", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "unstamped concrete response fixture",
      options: { seed: 13, startingHandSize: 1 },
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
        }),
      ],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "unstamped concrete response fixture",
        message: "No legal response matched type=changePhase player=0 phase=battle",
      },
    ]);
  });

  it("rejects partial concrete action window stamps", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "partial stamped concrete response fixture",
      options: { seed: 11, startingHandSize: 1 },
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
          windowId: 0,
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
        fixture: "partial stamped concrete response fixture",
        message: "No legal response matched type=changePhase player=0 windowId=0 windowKind=open phase=battle",
      },
    ]);
  });

  it("rejects malformed numeric concrete action window ids", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed numeric stamped concrete response fixture",
      options: { seed: 14, startingHandSize: 1 },
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
          windowId: Number.NaN,
          windowKind: "open",
          windowToken: "forged-window-token",
        }),
      ],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed numeric stamped concrete response fixture",
        message: "responses[0].response.windowId has malformed value NaN",
      },
    ]);
  });

  it("does not hide empty concrete response fields in failures", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "empty concrete response description fixture",
      options: { seed: 16, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      responses: [
        makeScriptedStep({
          type: "activateTrigger",
          player: 0,
          uid: "",
          effectId: "",
          triggerId: "",
          label: "Empty trigger identifiers",
        }),
      ],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "empty concrete response description fixture",
        message: "No legal response matched type=activateTrigger player=0 uid= effectId= triggerId=",
      },
    ]);
  });

  it("matches concrete responses by action window tokens", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "forged token concrete response fixture",
      options: { seed: 9, startingHandSize: 1 },
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
          windowId: 0,
          windowKind: "open",
          windowToken: "forged-window-token",
        }),
      ],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "forged token concrete response fixture",
        message: "No legal response matched type=changePhase player=0 windowId=0 windowKind=open windowToken=forged-window-token phase=battle",
      },
    ]);
  });

  it("matches grouped legal action expectations by action window tokens", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "forged token group expectation fixture",
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
            windowId: 0,
            windowKind: "open",
            windowToken: "forged-window-token",
            count: 1,
            actions: [{ type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open", count: 1 }],
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
        fixture: "forged token group expectation fixture",
        message: "before fixture (edopro): Expected legal action group player=0 label=Turn windowId=0 windowKind=open windowToken=forged-window-token matched 0, expected 1",
      },
    ]);
  });

  it("rejects malformed numeric grouped legal action window ids", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed numeric group expectation fixture",
      options: { seed: 17, startingHandSize: 1 },
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
            windowId: Number.NaN,
            windowKind: "open",
            windowToken: "forged-window-token",
            count: 1,
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
        fixture: "malformed numeric group expectation fixture",
        message: "before fixture (edopro): Expected legal action group player=0 label=Turn windowId=NaN windowKind=open windowToken=forged-window-token has malformed windowId",
      },
    ]);
  });

  it("rejects malformed numeric absent legal action window ids", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed numeric absent action expectation fixture",
      options: { seed: 18, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        absentLegalActions: [
          {
            type: "changePhase",
            player: 0,
            phase: "battle",
            windowId: Number.NaN,
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
        fixture: "malformed numeric absent action expectation fixture",
        message: "before fixture (edopro): Expected no legal action type=changePhase player=0 windowId=NaN phase=battle has malformed windowId",
      },
    ]);
  });

  it("rejects malformed legal action count expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed legal action count expectation fixture",
      options: { seed: 26, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActionCounts: { 0: Number.NaN },
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed legal action count expectation fixture",
        message: "before fixture (edopro): Expected player 0 legal action count has malformed count NaN",
      },
    ]);
  });

  it("rejects malformed legal action group count expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed legal action group count expectation fixture",
      options: { seed: 27, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActionGroupCounts: { 0: -1 },
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed legal action group count expectation fixture",
        message: "before fixture (edopro): Expected player 0 legal action group count has malformed count -1",
      },
    ]);
  });

  it("rejects malformed legal action count players", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed legal action count player fixture",
      options: { seed: 31, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActionCounts: { 2: 0 } as never,
        legalActionGroupCounts: { "-1": 0 } as never,
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed legal action count player fixture",
        message: "before fixture (edopro): Expected legal action count has malformed player 2",
      },
      {
        fixture: "malformed legal action count player fixture",
        message: "before fixture (edopro): Expected legal action group count has malformed player -1",
      },
    ]);
  });

  it("rejects malformed player number map expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed player number map fixture",
      options: { seed: 32, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        lifePoints: { 2: 0 } as never,
        battleDamage: { 0: Number.NaN },
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed player number map fixture",
        message: "before fixture (edopro): Expected lifePoints has malformed player 2",
      },
      {
        fixture: "malformed player number map fixture",
        message: "before fixture (edopro): Expected battleDamage[0] has malformed value NaN",
      },
    ]);
  });

  it("rejects malformed activity count expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed activity count fixture",
      options: { seed: 33, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        activityCounts: { 0: { summon: 0.5 }, "-1": { attack: 0 } } as never,
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed activity count fixture",
        message: "before fixture (edopro): Expected player 0 activity summon has malformed count 0.5",
      },
      {
        fixture: "malformed activity count fixture",
        message: "before fixture (edopro): Expected activityCounts has malformed player -1",
      },
    ]);
  });

  it("rejects malformed legal action match counts", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed legal action match count fixture",
      options: { seed: 28, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActions: [{ type: "changePhase", player: 0, phase: "battle", count: 1.5 }],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed legal action match count fixture",
        message: "before fixture (edopro): Expected legal action type=changePhase player=0 phase=battle has malformed count 1.5",
      },
    ]);
  });

  it("rejects malformed grouped legal action match counts", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed grouped legal action match count fixture",
      options: { seed: 29, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActionGroups: [{ player: 0, label: "Turn", count: Number.NaN }],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "malformed grouped legal action match count fixture",
        message: "before fixture (edopro): Expected legal action group player=0 label=Turn has malformed count NaN",
      },
    ]);
  });

  it("rejects malformed grouped legal action child match counts", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed grouped child legal action match count fixture",
      options: { seed: 30, startingHandSize: 1 },
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
            actions: [{ type: "changePhase", player: 0, phase: "battle", count: -1 }],
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
        fixture: "malformed grouped child legal action match count fixture",
        message: "before fixture (edopro): Expected legal action group player=0 label=Turn action type=changePhase player=0 phase=battle has malformed count -1",
      },
    ]);
  });

  it("rejects malformed absent legal action window kinds", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed absent action kind expectation fixture",
      options: { seed: 21, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        absentLegalActions: [
          {
            type: "changePhase",
            player: 0,
            phase: "battle",
            windowKind: "bogus" as "open",
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
        fixture: "malformed absent action kind expectation fixture",
        message: "before fixture (edopro): Expected no legal action type=changePhase player=0 windowKind=bogus phase=battle has malformed windowKind",
      },
    ]);
  });

  it("rejects malformed absent legal action window tokens", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed absent action token expectation fixture",
      options: { seed: 22, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        absentLegalActions: [
          {
            type: "changePhase",
            player: 0,
            phase: "battle",
            windowToken: "",
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
        fixture: "malformed absent action token expectation fixture",
        message: "before fixture (edopro): Expected no legal action type=changePhase player=0 windowToken= phase=battle has malformed windowToken",
      },
    ]);
  });

  it("rejects malformed numeric absent grouped legal action window ids", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed numeric absent group expectation fixture",
      options: { seed: 19, startingHandSize: 1 },
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
            windowId: Number.NaN,
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
        fixture: "malformed numeric absent group expectation fixture",
        message: "before fixture (edopro): Expected no legal action group player=0 label=Turn windowId=NaN has malformed windowId",
      },
    ]);
  });

  it("rejects malformed absent grouped legal action window kinds", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed absent group kind expectation fixture",
      options: { seed: 23, startingHandSize: 1 },
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
            windowKind: "bogus" as "open",
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
        fixture: "malformed absent group kind expectation fixture",
        message: "before fixture (edopro): Expected no legal action group player=0 label=Turn windowKind=bogus has malformed windowKind",
      },
    ]);
  });

  it("rejects malformed absent grouped legal action window tokens", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed absent group token expectation fixture",
      options: { seed: 24, startingHandSize: 1 },
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
            windowToken: "",
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
        fixture: "malformed absent group token expectation fixture",
        message: "before fixture (edopro): Expected no legal action group player=0 label=Turn windowToken= has malformed windowToken",
      },
    ]);
  });

  it("rejects malformed numeric absent grouped legal action child window ids", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed numeric absent group child expectation fixture",
      options: { seed: 20, startingHandSize: 1 },
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
            actions: [{ type: "changePhase", player: 0, phase: "battle", windowId: Number.NaN }],
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
        fixture: "malformed numeric absent group child expectation fixture",
        message: "before fixture (edopro): Expected no legal action group player=0 label=Turn action type=changePhase player=0 windowId=NaN phase=battle has malformed windowId",
      },
    ]);
  });

  it("rejects malformed absent grouped legal action child window stamps", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed absent group child stamp expectation fixture",
      options: { seed: 25, startingHandSize: 1 },
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
            actions: [{ type: "changePhase", player: 0, phase: "battle", windowKind: "bogus" as "open" }],
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
        fixture: "malformed absent group child stamp expectation fixture",
        message: "before fixture (edopro): Expected no legal action group player=0 label=Turn action type=changePhase player=0 windowKind=bogus phase=battle has malformed windowKind",
      },
    ]);
  });

  it("does not hide empty grouped legal action expectation fields in failures", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "empty group expectation description fixture",
      options: { seed: 15, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      before: {
        source: "edopro",
        legalActionGroups: [
          {
            player: 0,
            key: "",
            label: "",
            windowKind: "" as "open",
            windowToken: "",
            count: 1,
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
        fixture: "empty group expectation description fixture",
        message: "before fixture (edopro): Expected legal action group player=0 key= label= windowKind= windowToken= has malformed windowKind",
      },
    ]);
  });

  it("requires concrete uid-bearing responses to echo the uid", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "missing uid concrete response fixture",
      options: { seed: 10, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      responses: [
        makeScriptedStep({
          type: "normalSummon",
          player: 0,
          label: "Normal Summon without uid",
        }),
      ],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "missing uid concrete response fixture",
        message: "No legal response matched type=normalSummon player=0",
      },
    ]);
  });

  it("matches concrete trigger responses by effect id", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "trigger effect-id response fixture",
      options: { seed: 7, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["200", "200"] },
      },
      setup: {
        effects: [
          {
            id: "available-trigger",
            player: 0,
            code: "300",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep({
          type: "activateTrigger",
          player: 0,
          triggerId: "trigger-7-1",
          triggerBucket: "turnOptional",
          uid: "p0-deck-300-1",
          effectId: "missing-trigger",
          label: "Activate trigger",
        }),
      ],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "trigger effect-id response fixture",
        message: "No legal response matched type=activateTrigger player=0 uid=p0-deck-300-1 effectId=missing-trigger triggerId=trigger-7-1",
      },
    ]);
  });

  it("matches concrete direct attacks by explicit direct attack intent", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "direct attack intent response fixture",
      options: { seed: 8, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep({
          type: "declareAttack",
          player: 0,
          attackerUid: "p0-deck-100-0",
          label: "Direct attack without intent marker",
        }),
      ],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        fixture: "direct attack intent response fixture",
        message: "No legal response matched type=declareAttack player=0 attackerUid=p0-deck-100-0",
      },
    ]);
  });
});
