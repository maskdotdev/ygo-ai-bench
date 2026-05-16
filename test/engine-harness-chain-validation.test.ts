import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness chain validation", () => {
  it("rejects malformed chain expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed chain fixture",
        options: { seed: 61, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          chain: [
            {
              id: 100,
              player: 2,
              sourceUid: false,
              effectId: 300,
              eventName: "bogus",
              eventCode: Number.NaN,
              eventPlayer: -1,
              eventValue: 0.5,
              eventReasonPlayer: 3,
              eventCurrentState: { controller: 3, location: "sideDeck", sequence: 1.5, position: "defense", faceUp: null, extra: 1 },
              eventUids: ["ok", false],
              eventTriggerTiming: "sometimes",
              effectLabelObjectUids: "bad",
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
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0] has malformed key bogus" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].id has malformed value 100" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].sourceUid has malformed value false" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].effectId has malformed value 300" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventCode has malformed value NaN" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventValue has malformed value 0.5" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].player has malformed player 2" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventPlayer has malformed player -1" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventReasonPlayer has malformed player 3" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventName has malformed value bogus" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventTriggerTiming has malformed value sometimes" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventCurrentState has malformed key extra" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventCurrentState.controller has malformed player 3" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventCurrentState.location has malformed value sideDeck" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventCurrentState.sequence has malformed value 1.5" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventCurrentState.position has malformed value defense" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventCurrentState.faceUp has malformed value null" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].eventUids[1] has malformed value false" },
      { fixture: "malformed chain fixture", message: "before fixture (edopro): Expected chain[0].effectLabelObjectUids has malformed value bad" },
    ]);
  });

  it("rejects malformed chain expectation entries by index", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed chain entry fixture",
        options: { seed: 62, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          chain: ["chain" as never],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed chain entry fixture", message: "before fixture (edopro): Expected chain[0] has malformed value chain" },
    ]);
  });

  it("requires chain event expectations to pin trigger timing", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "missing chain event trigger timing fixture",
        options: { seed: 64, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          chain: [{ player: 0, effectId: "fixture-trigger", ["eventName"]: "normalSummoned" }],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "missing chain event trigger timing fixture", message: "before fixture (edopro): Expected chain[0].eventTriggerTiming is required when eventName is set" },
    ]);
  });

  it("rejects malformed chain expectation containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed chain container fixture",
        options: { seed: 63, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          chain: "chain" as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed chain container fixture", message: "before fixture (edopro): Expected chain has malformed value chain" },
    ]);
  });
});
