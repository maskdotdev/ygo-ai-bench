import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity sent-to-hand confirmed missed timing decline fixture", () => {
  it("returns declined optional if sent-to-hand confirmed triggers to open fast priority while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Hand Confirm Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Hand Confirm Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Hand Confirm Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Hand Confirm", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Shown Hand Body", kind: "monster", attack: 900, defense: 900 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "sent-to-hand confirmed missed timing decline open fast fixture",
      options: { seed: 79, startingHandSize: 6 },
      decks: {
        0: { main: ["100", "400", "500", "800", "600", "700"] },
        1: { main: ["600", "600", "600", "600", "600", "600"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "hand-confirm-decline-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            collectEventsOnResolve: [
              {
                collectEvent: "sentToHandConfirmed",
                eventIsLast: false,
                eventPlayer: 1,
                eventValue: 1,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 7901,
                eventUids: ["p0-deck-600-4"],
              },
            ],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Hand confirm decline multi step resolved",
          },
          {
            id: "hand-confirm-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToHandConfirmed",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Hand confirm decline optional when should not resolve",
          },
          {
            id: "hand-confirm-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToHandConfirmed",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Hand confirm decline optional if should not resolve",
          },
          {
            id: "hand-confirm-decline-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Hand confirm decline open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "hand-confirm-decline-multistep" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the initial sent-to-hand confirm effect window restorable before optional missed-timing filtering",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "hand-confirm-decline-open-fast", count: 1 },
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "hand-confirm-decline-multistep", count: 1 },
            ],
            legalActionGroups: [openEffectGroup(0, "hand-confirm-decline-open-fast", 1, 0)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "hand-confirm-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "hand-confirm-decline-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "hand-confirm-decline-optional-when", "turnOptional", 0, "open"),
              absentTriggerActivationGroup(0, "hand-confirm-decline-optional-if", "turnOptional", 0, "open"),
            ],

            legalActionCounts: { 0: 15, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },},
          after: {
            source: "edopro",
            note: "EDOPro keeps optional if sent-to-hand confirmed triggers available while optional when triggers miss timing",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "hand-confirm-decline-optional-if",
                eventName: "sentToHandConfirmed",
                eventCode: 1212,
                eventPlayer: 1,
                eventValue: 1,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 7901,
                eventUids: ["p0-deck-600-4"],
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            eventHistory: [
              { eventName: "chainActivating", eventCardUid: "p0-deck-100-0" },
              { eventName: "chaining", eventCardUid: "p0-deck-100-0" },
              { eventName: "chainSolving", eventCardUid: "p0-deck-100-0" },
              { eventName: "sentToHandConfirmed", eventCode: 1212, eventUids: ["p0-deck-600-4"], eventPlayer: 1, eventValue: 1, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: "p0-deck-100-0", eventReasonEffectId: 7901 },
              { eventName: "chainSolved" },
            ],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "hand-confirm-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "hand-confirm-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "hand-confirm-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "hand-confirm-decline-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-decline-open-fast" },
            ],
            logIncludes: ["Hand confirm decline multi step resolved"],

            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },},
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "hand-confirm-decline-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if sent-to-hand confirmed trigger decline restorable while optional when remains missed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "hand-confirm-decline-optional-if",
                eventName: "sentToHandConfirmed",
                eventCode: 1212,
                eventPlayer: 1,
                eventValue: 1,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 7901,
                eventUids: ["p0-deck-600-4"],
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "hand-confirm-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "hand-confirm-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "hand-confirm-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "hand-confirm-decline-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-decline-open-fast" },
            ],

            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },},
          after: {
            source: "edopro",
            note: "EDOPro exposes open fast effects after declining the surviving optional if sent-to-hand confirmed trigger",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "hand-confirm-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "hand-confirm-decline-open-fast", 1, 2)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "hand-confirm-decline-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "hand-confirm-decline-optional-if", "turnOptional", 2, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "hand-confirm-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "hand-confirm-decline-optional-if" },
            ],
            logIncludes: ["Hand confirm decline multi step resolved", "hand-confirm-decline-optional-if"],

            legalActionCounts: { 0: 14, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },},
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "hand-confirm-decline-open-fast" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the sent-to-hand confirmed post-decline open fast-effect window restorable after missed-timing filtering",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "hand-confirm-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "hand-confirm-decline-open-fast", 1, 2)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "hand-confirm-decline-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "hand-confirm-decline-optional-if", "turnOptional", 2, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "hand-confirm-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "hand-confirm-decline-optional-if" },
            ],
            logIncludes: ["Hand confirm decline multi step resolved", "hand-confirm-decline-optional-if"],

            legalActionCounts: { 0: 14, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },},
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored post-decline open fast effect without resurrecting missed optional when triggers for sent-to-hand confirmed events",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "hand-confirm-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "hand-confirm-decline-open-fast", 1, 3)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "hand-confirm-decline-optional-when", "turnOptional", 3, "open"),
              absentTriggerActivationGroup(0, "hand-confirm-decline-optional-if", "turnOptional", 3, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "hand-confirm-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "hand-confirm-decline-optional-if" },
            ],
            logIncludes: ["Hand confirm decline multi step resolved", "hand-confirm-decline-optional-if", "Hand confirm decline open fast resolved"],

            legalActionCounts: { 0: 14, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },},
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after the restored sent-to-hand confirmed post-decline open fast effect while optional when remains missed",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "hand-confirm-decline-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "hand-confirm-decline-open-fast", 1, 3)],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "hand-confirm-decline-optional-when", "turnOptional", 3, "open"),
          absentTriggerActivationGroup(0, "hand-confirm-decline-optional-if", "turnOptional", 3, "open"),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "hand-confirm-decline-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "hand-confirm-decline-optional-if" },
        ],
        logIncludes: ["Hand confirm decline multi step resolved", "hand-confirm-decline-optional-if", "Hand confirm decline open fast resolved"],

        legalActionCounts: { 0: 14, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },},
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
