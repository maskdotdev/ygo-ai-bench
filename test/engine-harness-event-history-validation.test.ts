import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness event history validation", () => {
  it("rejects malformed event history expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed event history fixture",
        options: { seed: 63, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          eventHistory: [
            {
              eventName: "bogus",
              eventCode: Number.NaN,
              eventPlayer: -1,
              eventValue: 0.5,
              eventReasonPlayer: 3,
              eventCardUid: false,
              eventCurrentState: { controller: -1, location: "removed", sequence: Number.NaN, position: "attack", faceUp: 1, bogus: 0 },
              eventUids: ["ok", false],
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
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0] has malformed key bogus" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventCardUid has malformed value false" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventCode has malformed value NaN" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventValue has malformed value 0.5" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventPlayer has malformed player -1" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventReasonPlayer has malformed player 3" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventName has malformed value bogus" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventCurrentState has malformed key bogus" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventCurrentState.controller has malformed player -1" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventCurrentState.location has malformed value removed" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventCurrentState.sequence has malformed value NaN" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventCurrentState.position has malformed value attack" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventCurrentState.faceUp has malformed value 1" },
      { fixture: "malformed event history fixture", message: "before fixture (edopro): Expected eventHistory[0].eventUids[1] has malformed value false" },
    ]);
  });

  it("rejects malformed event history expectation entries by index", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed event history entry fixture",
        options: { seed: 64, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          eventHistory: [false as never],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed event history entry fixture", message: "before fixture (edopro): Expected eventHistory[0] has malformed value false" },
    ]);
  });

  it("rejects malformed event history expectation containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed event history container fixture",
        options: { seed: 71, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          eventHistory: "event" as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed event history container fixture", message: "before fixture (edopro): Expected eventHistory has malformed value event" },
    ]);
  });
});
