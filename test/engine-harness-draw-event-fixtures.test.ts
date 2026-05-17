import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import { openEffectGroup, triggerActivationGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro compatibility harness draw event fixtures", () => {
  it("carries related effect metadata from scripted draw events", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 400, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "draw event related effect packet fixture",
        options: { seed: 18, startingHandSize: 0 },
        decks: {
          0: { main: ["100", "400", "200"] },
          1: { main: ["200", "200"] },
        },
        setup: {
          moveCards: [
            { player: 0, code: "100", from: "deck", to: "hand" },
            { player: 0, code: "400", from: "deck", to: "hand" },
          ],
          effects: [
            {
              id: "draw-event-starter",
              player: 0,
              code: "100",
              location: "hand",
              event: "ignition",
              range: ["hand"],
              drawCardsOnResolve: [
                {
                  player: 0,
                  count: 1,
                  eventReason: 0x40,
                  eventReasonPlayer: 0,
                  eventReasonCardUid: "p0-deck-100-0",
                  eventReasonEffectId: 1801,
                  relatedEffectId: 1802,
                },
              ],
            },
            {
              id: "draw-event-trigger",
              player: 0,
              code: "400",
              location: "hand",
              event: "trigger",
              triggerEvent: "cardsDrawn",
              triggerTiming: "if",
              range: ["hand"],
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "draw-event-starter" }), {
            snapshotRestore: "both",
            before: {
              source: "edopro",
              note: "EDOPro keeps the scripted draw effect restorable before draw-event cause metadata is collected",
              windowId: 0,
              windowKind: "open",
              waitingFor: 0,
              legalActions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "draw-event-starter", count: 1 }],
              legalActionGroups: [openEffectGroup(0, "draw-event-starter", 1, 0)],
            },
            after: {
              source: "edopro",
              note: "EDOPro draw events preserve related effect metadata beside the source reason card/effect",
              windowId: 1,
              windowKind: "triggerBucket",
              waitingFor: 0,
              pendingTriggers: [
                {
                  player: 0,
                  effectId: "draw-event-trigger",
                  eventName: "cardsDrawn",
                  eventCode: 1110,
                  eventPlayer: 0,
                  eventValue: 1,
                  eventReason: 0x40,
                  eventReasonPlayer: 0,
                  eventReasonCardUid: "p0-deck-100-0",
                  eventReasonEffectId: 1801,
                  relatedEffectId: 1802,
                  eventUids: ["p0-deck-200-2"],
                  eventCardUid: "p0-deck-200-2",
                  eventTriggerTiming: "if",
                },
              ],
              eventHistory: [
                {},
                {},
                {},
                {
                  eventName: "cardsDrawn",
                  eventCode: 1110,
                  eventPlayer: 0,
                  eventValue: 1,
                  eventReason: 0x40,
                  eventReasonPlayer: 0,
                  eventReasonCardUid: "p0-deck-100-0",
                  eventReasonEffectId: 1801,
                  relatedEffectId: 1802,
                  eventUids: ["p0-deck-200-2"],
                  eventCardUid: "p0-deck-200-2",
                },
                {},
              ],
              legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "draw-event-trigger", count: 1 }],
              legalActionGroups: [triggerActivationGroup(0, "draw-event-trigger", "turnOptional", 1, 1)],
            },
          }),
        ],
        expected: {
          source: "edopro",
          note: "EDOPro keeps draw-event related effect metadata in the final restored trigger bucket",
          windowId: 1,
          windowKind: "triggerBucket",
          waitingFor: 0,
          pendingTriggers: [
            {
              player: 0,
              effectId: "draw-event-trigger",
              eventName: "cardsDrawn",
              eventCode: 1110,
              eventPlayer: 0,
              eventValue: 1,
              eventReason: 0x40,
              eventReasonPlayer: 0,
              eventReasonCardUid: "p0-deck-100-0",
              eventReasonEffectId: 1801,
              relatedEffectId: 1802,
              eventUids: ["p0-deck-200-2"],
              eventCardUid: "p0-deck-200-2",
              eventTriggerTiming: "if",
            },
          ],
          eventHistory: [
            {},
            {},
            {},
            {
              eventName: "cardsDrawn",
              eventCode: 1110,
              eventPlayer: 0,
              eventValue: 1,
              eventReason: 0x40,
              eventReasonPlayer: 0,
              eventReasonCardUid: "p0-deck-100-0",
              eventReasonEffectId: 1801,
              relatedEffectId: 1802,
              eventUids: ["p0-deck-200-2"],
              eventCardUid: "p0-deck-200-2",
            },
            {},
          ],
          legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "draw-event-trigger", count: 1 }],
          legalActionGroups: [triggerActivationGroup(0, "draw-event-trigger", "turnOptional", 1, 1)],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });
});
