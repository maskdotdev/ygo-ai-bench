import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness pending trigger validation", () => {
  it("rejects malformed pending trigger expectations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed pending trigger fixture",
        options: { seed: 60, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          pendingTriggers: [
            {
              id: 100,
              player: 2,
              sourceUid: false,
              effectId: 300,
              eventName: "bogus",
              triggerBucket: "later",
              eventCode: Number.NaN,
              eventPlayer: -1,
              eventValue: 0.5,
              eventReasonPlayer: 3,
              eventPreviousState: { controller: 2, location: "nowhere", sequence: -1, position: "attack", faceUp: "yes", bogus: true },
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
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0] has malformed key bogus" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].id has malformed value 100" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].sourceUid has malformed value false" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].effectId has malformed value 300" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventCode has malformed value NaN" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventValue has malformed value 0.5" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].player has malformed player 2" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventPlayer has malformed player -1" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventReasonPlayer has malformed player 3" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventName has malformed value bogus" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].triggerBucket has malformed value later" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventTriggerTiming has malformed value sometimes" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventPreviousState has malformed key bogus" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventPreviousState.controller has malformed player 2" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventPreviousState.location has malformed value nowhere" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventPreviousState.sequence has malformed value -1" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventPreviousState.position has malformed value attack" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventPreviousState.faceUp has malformed value yes" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventUids[1] has malformed value false" },
      { fixture: "malformed pending trigger fixture", message: "before fixture (edopro): Expected pendingTriggers[0].effectLabelObjectUids has malformed value bad" },
    ]);
  });

  it("rejects malformed pending trigger expectation entries by index", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed pending trigger entry fixture",
        options: { seed: 61, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          pendingTriggers: [9 as never],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed pending trigger entry fixture", message: "before fixture (edopro): Expected pendingTriggers[0] has malformed value 9" },
    ]);
  });

  it("requires pending trigger event expectations to pin trigger timing", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "missing pending trigger event timing fixture",
        options: { seed: 62, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          pendingTriggers: [{ player: 0, effectId: "fixture-trigger", ["eventName"]: "normalSummoned", triggerBucket: "turnOptional" }],
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "missing pending trigger event timing fixture", message: "before fixture (edopro): Expected pendingTriggers[0].eventTriggerTiming is required when eventName is set" },
    ]);
  });

  it("rejects malformed pending trigger expectation containers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "malformed pending trigger container fixture",
        options: { seed: 70, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        before: {
          source: "edopro",
          pendingTriggers: "pending" as never,
        },
        responses: [],
        expected: { source: "edopro" },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed pending trigger container fixture", message: "before fixture (edopro): Expected pendingTriggers has malformed value pending" },
    ]);
  });
});
