import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness card validation", () => {
  it("rejects malformed card expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed card fixture",
        options: { seed: 66, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          cards: [
            {
              uid: false,
              code: 100,
              name: 200,
              kind: "ritual",
              owner: 2,
              controller: 3,
              location: "sideDeck",
              sequence: 0.5,
              position: "attack",
              faceUp: "yes",
              overlayCount: -1,
              counters: { x: 1, 1: 0.5 },
              reason: 0.5,
              reasonPlayer: 2,
              reasonCardUid: 300,
              reasonEffectId: "effect",
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
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0] has malformed key bogus" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].uid has malformed value false" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].code has malformed value 100" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].name has malformed value 200" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].kind has malformed value ritual" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].owner has malformed player 2" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].controller has malformed player 3" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].location has malformed value sideDeck" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].sequence has malformed value 0.5" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].position has malformed value attack" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].faceUp has malformed value yes" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].overlayCount has malformed value -1" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].counters[1] has malformed value 0.5" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].counters has malformed counter x" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].reason has malformed value 0.5" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].reasonPlayer has malformed player 2" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].reasonCardUid has malformed value 300" },
      { fixture: "malformed card fixture", message: "before fixture (edopro): Expected cards[0].reasonEffectId has malformed value effect" },
    ]);
  });

  it("rejects malformed card expectation entries by index", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed card entry fixture",
        options: { seed: 67, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          cards: [7 as never],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed card entry fixture", message: "before fixture (edopro): Expected cards[0] has malformed value 7" },
    ]);
  });

  it("rejects malformed card expectation containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed card container fixture",
        options: { seed: 68, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          cards: "cards" as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed card container fixture", message: "before fixture (edopro): Expected cards has malformed value cards" },
    ]);
  });
});
