import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness window validation", () => {
  it("rejects prompt fields that do not belong to the prompt type", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed prompt shape fixture",
        options: { seed: 67, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          prompt: {
            id: "bad-prompt",
            type: "selectOption",
            player: 0,
            options: [1],
            description: 1,
          } as never,
        },
        responses: [],
        expected: {
          source: "edopro",
          prompt: {
            id: "bad-yes-no-prompt",
            type: "selectYesNo",
            player: 1,
            options: [1],
          } as never,
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed prompt shape fixture", message: "before fixture (edopro): Expected prompt.description has malformed field for selectOption" },
      { fixture: "malformed prompt shape fixture", message: "final expected (edopro): Expected prompt.options has malformed field for selectYesNo" },
    ]);
  });

  it("rejects malformed top-level window expectation keys", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed window key fixture",
        options: { seed: 67, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        responses: [],
        expected: {
          source: "edopro",
          stale: true,
        } as never,
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed window key fixture", message: "final expected (edopro): Expected window has malformed key stale" },
    ]);
  });

  it("rejects malformed skipped phase expectation keys", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed skipped phase fixture",
        options: { seed: 67, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        responses: [],
        expected: {
          source: "edopro",
          skippedPhases: [{ player: 0, phase: "main1", remaining: 1, stale: true }],
        } as never,
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed skipped phase fixture", message: "final expected (edopro): Expected skippedPhases[0] has malformed key stale" },
    ]);
  });

  it("rejects malformed skipped phase expectation containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed skipped phase container fixture",
        options: { seed: 67, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        responses: [],
        expected: {
          source: "edopro",
          skippedPhases: "main1",
        } as never,
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed skipped phase container fixture", message: "final expected (edopro): Expected skippedPhases has malformed value main1" },
    ]);
  });

  it("rejects malformed nested window expectation containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed nested window containers fixture",
        options: { seed: 67, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        responses: [],
        expected: {
          source: "edopro",
          options: "options",
          battleWindow: "battle",
          prompt: "prompt",
          triggerOrderPrompt: "trigger",
        } as never,
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed nested window containers fixture", message: "final expected (edopro): Expected options has malformed value options" },
      { fixture: "malformed nested window containers fixture", message: "final expected (edopro): Expected battleWindow has malformed value battle" },
      { fixture: "malformed nested window containers fixture", message: "final expected (edopro): Expected prompt has malformed value prompt" },
      { fixture: "malformed nested window containers fixture", message: "final expected (edopro): Expected triggerOrderPrompt has malformed value trigger" },
    ]);
  });

  it("reports malformed window list entries by index", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed window list entries fixture",
        options: { seed: 67, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        responses: [],
        expected: {
          source: "edopro",
          lastDiceResults: [1, NaN],
          chainPasses: [0, 2],
          logIncludes: ["draw", 7],
        } as never,
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed window list entries fixture", message: "final expected (edopro): Expected lastDiceResults[1] has malformed value NaN" },
      { fixture: "malformed window list entries fixture", message: "final expected (edopro): Expected chainPasses[1] has malformed player 2" },
      { fixture: "malformed window list entries fixture", message: "final expected (edopro): Expected logIncludes[1] has malformed value 7" },
    ]);
  });
});
