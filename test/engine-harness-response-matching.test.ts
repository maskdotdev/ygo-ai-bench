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
        message: "No legal response matched type=changePhase player=0 windowId=1 phase=battle",
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
        message: "No legal response matched type=changePhase player=0 windowId=0 phase=battle",
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
