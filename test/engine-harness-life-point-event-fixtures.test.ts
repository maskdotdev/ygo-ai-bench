import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import { openEffectGroup, triggerActivationGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro compatibility harness life point event fixtures", () => {
  it("applies scripted damage while carrying related effect metadata", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 400, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "damage event related effect packet fixture",
        options: { seed: 19, startingHandSize: 0 },
        decks: {
          0: { main: ["100", "400"] },
          1: { main: ["400"] },
        },
        setup: {
          moveCards: [
            { player: 0, code: "100", from: "deck", to: "hand" },
            { player: 0, code: "400", from: "deck", to: "hand" },
          ],
          effects: [
            {
              id: "damage-event-starter",
              player: 0,
              code: "100",
              location: "hand",
              event: "ignition",
              range: ["hand"],
              damagePlayerOnResolve: [
                {
                  player: 1,
                  amount: 700,
                  eventReason: 0x40,
                  eventReasonPlayer: 0,
                  eventReasonCardUid: "p0-deck-100-0",
                  eventReasonEffectId: 1901,
                  relatedEffectId: 1902,
                },
              ],
            },
            {
              id: "damage-event-trigger",
              player: 0,
              code: "400",
              location: "hand",
              event: "trigger",
              triggerEvent: "damageDealt",
              triggerTiming: "if",
              range: ["hand"],
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "damage-event-starter" }), {
            snapshotRestore: "both",
            before: {
              source: "edopro",
              note: "EDOPro keeps the scripted damage effect restorable before damage-event cause metadata is collected",
              windowId: 0,
              windowKind: "open",
              waitingFor: 0,
              lifePoints: { 1: 8000 },
              legalActions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "damage-event-starter", count: 1 }],
              legalActionGroups: [openEffectGroup(0, "damage-event-starter", 1, 0)],
            },
            after: {
              source: "edopro",
              note: "EDOPro damage events preserve applied LP loss and related effect metadata",
              windowId: 1,
              windowKind: "triggerBucket",
              waitingFor: 0,
              lifePoints: { 1: 7300 },
              pendingTriggers: [
                {
                  player: 0,
                  effectId: "damage-event-trigger",
                  eventName: "damageDealt",
                  eventCode: 1111,
                  eventPlayer: 1,
                  eventValue: 700,
                  eventReason: 0x40,
                  eventReasonPlayer: 0,
                  eventReasonCardUid: "p0-deck-100-0",
                  eventReasonEffectId: 1901,
                  relatedEffectId: 1902,
                  eventTriggerTiming: "if",
                },
              ],
              eventHistory: [
                {},
                {},
                {},
                {
                  eventName: "damageDealt",
                  eventCode: 1111,
                  eventPlayer: 1,
                  eventValue: 700,
                  eventReason: 0x40,
                  eventReasonPlayer: 0,
                  eventReasonCardUid: "p0-deck-100-0",
                  eventReasonEffectId: 1901,
                  relatedEffectId: 1902,
                },
                {},
              ],
              legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "damage-event-trigger", count: 1 }],
              legalActionGroups: [triggerActivationGroup(0, "damage-event-trigger", "turnOptional", 1, 1)],
            },
          }),
        ],
        expected: {
          source: "edopro",
          note: "EDOPro keeps damage-event related effect metadata in the final restored trigger bucket",
          windowId: 1,
          windowKind: "triggerBucket",
          waitingFor: 0,
          lifePoints: { 1: 7300 },
          pendingTriggers: [
            {
              player: 0,
              effectId: "damage-event-trigger",
              eventName: "damageDealt",
              eventCode: 1111,
              eventPlayer: 1,
              eventValue: 700,
              eventReason: 0x40,
              eventReasonPlayer: 0,
              eventReasonCardUid: "p0-deck-100-0",
              eventReasonEffectId: 1901,
              relatedEffectId: 1902,
              eventTriggerTiming: "if",
            },
          ],
          eventHistory: [
            {},
            {},
            {},
            {
              eventName: "damageDealt",
              eventCode: 1111,
              eventPlayer: 1,
              eventValue: 700,
              eventReason: 0x40,
              eventReasonPlayer: 0,
              eventReasonCardUid: "p0-deck-100-0",
              eventReasonEffectId: 1901,
              relatedEffectId: 1902,
            },
            {},
          ],
          legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "damage-event-trigger", count: 1 }],
          legalActionGroups: [triggerActivationGroup(0, "damage-event-trigger", "turnOptional", 1, 1)],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("applies scripted recovery while carrying related effect metadata", () => {
    const cards = normalizeCdbRows([{ id: 110, type: 1 }, { id: 410, type: 1 }], []);
    const result = runScriptedDuelFixture(
      {
        name: "recovery event related effect packet fixture",
        options: { seed: 20, startingHandSize: 0, startingLifePoints: 6500 },
        decks: {
          0: { main: ["110", "410"] },
          1: { main: ["410"] },
        },
        setup: {
          moveCards: [
            { player: 0, code: "110", from: "deck", to: "hand" },
            { player: 0, code: "410", from: "deck", to: "hand" },
          ],
          effects: [
            {
              id: "recovery-event-starter",
              player: 0,
              code: "110",
              location: "hand",
              event: "ignition",
              range: ["hand"],
              recoverPlayerOnResolve: [
                {
                  player: 0,
                  amount: 900,
                  eventReason: 0x40,
                  eventReasonPlayer: 0,
                  eventReasonCardUid: "p0-deck-110-0",
                  eventReasonEffectId: 2001,
                  relatedEffectId: 2002,
                },
              ],
            },
            {
              id: "recovery-event-trigger",
              player: 0,
              code: "410",
              location: "hand",
              event: "trigger",
              triggerEvent: "recoveredLifePoints",
              triggerTiming: "if",
              range: ["hand"],
            },
          ],
        },
        responses: [
          makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "recovery-event-starter" }), {
            snapshotRestore: "both",
            before: {
              source: "edopro",
              note: "EDOPro keeps the scripted recovery effect restorable before recovery-event cause metadata is collected",
              windowId: 0,
              windowKind: "open",
              waitingFor: 0,
              lifePoints: { 0: 6500 },
              legalActions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "recovery-event-starter", count: 1 }],
              legalActionGroups: [openEffectGroup(0, "recovery-event-starter", 1, 0)],
            },
            after: {
              source: "edopro",
              note: "EDOPro recovery events preserve applied LP gain and related effect metadata",
              windowId: 1,
              windowKind: "triggerBucket",
              waitingFor: 0,
              lifePoints: { 0: 7400 },
              pendingTriggers: [
                {
                  player: 0,
                  effectId: "recovery-event-trigger",
                  eventName: "recoveredLifePoints",
                  eventCode: 1112,
                  eventPlayer: 0,
                  eventValue: 900,
                  eventReason: 0x40,
                  eventReasonPlayer: 0,
                  eventReasonCardUid: "p0-deck-110-0",
                  eventReasonEffectId: 2001,
                  relatedEffectId: 2002,
                  eventTriggerTiming: "if",
                },
              ],
              eventHistory: [
                {},
                {},
                {},
                {
                  eventName: "recoveredLifePoints",
                  eventCode: 1112,
                  eventPlayer: 0,
                  eventValue: 900,
                  eventReason: 0x40,
                  eventReasonPlayer: 0,
                  eventReasonCardUid: "p0-deck-110-0",
                  eventReasonEffectId: 2001,
                  relatedEffectId: 2002,
                },
                {},
              ],
              legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "recovery-event-trigger", count: 1 }],
              legalActionGroups: [triggerActivationGroup(0, "recovery-event-trigger", "turnOptional", 1, 1)],
            },
          }),
        ],
        expected: {
          source: "edopro",
          note: "EDOPro keeps recovery-event related effect metadata in the final restored trigger bucket",
          windowId: 1,
          windowKind: "triggerBucket",
          waitingFor: 0,
          lifePoints: { 0: 7400 },
          pendingTriggers: [
            {
              player: 0,
              effectId: "recovery-event-trigger",
              eventName: "recoveredLifePoints",
              eventCode: 1112,
              eventPlayer: 0,
              eventValue: 900,
              eventReason: 0x40,
              eventReasonPlayer: 0,
              eventReasonCardUid: "p0-deck-110-0",
              eventReasonEffectId: 2001,
              relatedEffectId: 2002,
              eventTriggerTiming: "if",
            },
          ],
          eventHistory: [
            {},
            {},
            {},
            {
              eventName: "recoveredLifePoints",
              eventCode: 1112,
              eventPlayer: 0,
              eventValue: 900,
              eventReason: 0x40,
              eventReasonPlayer: 0,
              eventReasonCardUid: "p0-deck-110-0",
              eventReasonEffectId: 2001,
              relatedEffectId: 2002,
            },
            {},
          ],
          legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "recovery-event-trigger", count: 1 }],
          legalActionGroups: [triggerActivationGroup(0, "recovery-event-trigger", "turnOptional", 1, 1)],
        },
      },
      { cardReader: createCardReader(cards) },
    );

    expect(result).toEqual({ ok: true, failures: [] });
  });
});
