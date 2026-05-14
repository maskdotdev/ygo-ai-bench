import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness trigger bucket validation", () => {
  it("rejects malformed pending trigger bucket expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed pending trigger bucket fixture",
        options: { seed: 59, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          pendingTriggerBuckets: [
            { player: 2, triggerBucket: "later", triggerIds: "bad", bogus: 1 },
            { triggerIds: ["ok", false] },
          ] as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed pending trigger bucket fixture", message: "before fixture (edopro): Expected pendingTriggerBuckets[0] has malformed key bogus" },
      { fixture: "malformed pending trigger bucket fixture", message: "before fixture (edopro): Expected pendingTriggerBuckets[0].triggerBucket has malformed value later" },
      { fixture: "malformed pending trigger bucket fixture", message: "before fixture (edopro): Expected pendingTriggerBuckets[0].player has malformed player 2" },
      { fixture: "malformed pending trigger bucket fixture", message: "before fixture (edopro): Expected pendingTriggerBuckets[0].triggerIds has malformed value bad" },
      { fixture: "malformed pending trigger bucket fixture", message: "before fixture (edopro): Expected pendingTriggerBuckets[1].triggerIds[1] has malformed value false" },
    ]);
  });

  it("rejects malformed pending trigger bucket expectation entries by index", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed pending trigger bucket entry fixture",
        options: { seed: 60, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          pendingTriggerBuckets: [false as never],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed pending trigger bucket entry fixture", message: "before fixture (edopro): Expected pendingTriggerBuckets[0] has malformed value false" },
    ]);
  });

  it("rejects malformed pending trigger bucket expectation containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed pending trigger bucket container fixture",
        options: { seed: 61, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          pendingTriggerBuckets: "buckets" as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed pending trigger bucket container fixture", message: "before fixture (edopro): Expected pendingTriggerBuckets has malformed value buckets" },
    ]);
  });
});
