import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness event state fixtures", () => {
  it("carries explicit event state packets from setup events", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const explicitPreviousState = { controller: 1, location: "deck", sequence: 4, position: "faceDown", faceUp: false } as const;
    const explicitCurrentState = { controller: 0, location: "graveyard", sequence: 2, position: "faceDown", faceUp: true } as const;
    const result = runScriptedDuelFixture(
      {
        name: "setup event explicit state packet fixture",
        options: { seed: 17, startingHandSize: 1 },
        decks: {
          0: { main: ["100"] },
          1: { main: ["200"] },
        },
        setup: {
          effects: [
            {
              id: "explicit-state-custom-trigger",
              player: 0,
              code: "100",
              location: "hand",
              event: "trigger",
              triggerEvent: "customEvent",
              triggerTiming: "if",
              triggerCode: 0x10000009,
              range: ["hand"],
            },
          ],
          collectEvents: [
            {
              collectEvent: "customEvent",
              eventCode: 0x10000009,
              eventPreviousState: explicitPreviousState,
              eventCurrentState: explicitCurrentState,
            },
          ],
        },
        responses: [],
        expected: {
          source: "edopro",
          windowId: 0,
          windowKind: "triggerBucket",
          waitingFor: 0,
          pendingTriggers: [
            {
              player: 0,
              effectId: "explicit-state-custom-trigger",
              eventName: "customEvent",
              eventCode: 0x10000009,
              eventPreviousState: explicitPreviousState,
              eventCurrentState: explicitCurrentState,
              eventTriggerTiming: "if",
            },
          ],
          eventHistory: [
            {
              eventName: "customEvent",
              eventCode: 0x10000009,
              eventPreviousState: explicitPreviousState,
              eventCurrentState: explicitCurrentState,
            },
          ],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });
});
