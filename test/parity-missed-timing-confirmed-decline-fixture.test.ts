import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity confirmed missed timing decline fixture", () => {
  it("returns declined optional if confirmed triggers to open fast priority while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Confirm Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Confirm Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Confirm Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Confirm", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Confirmed Body", kind: "monster", attack: 900, defense: 900 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "confirmed missed timing decline open fast fixture",
      options: { seed: 77, startingHandSize: 6 },
      decks: {
        0: { main: ["100", "400", "500", "800", "600", "700"] },
        1: { main: ["600", "600", "600", "600", "600", "600"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "confirm-decline-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            collectEventsOnResolve: [
              {
                collectEvent: "confirmed",
                eventCard: { player: 0, code: "600", location: "hand" },
                eventIsLast: false,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 7701,
              },
            ],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Confirm decline multi step resolved",
          },
          {
            id: "confirm-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "confirmed",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Confirm decline optional when should not resolve",
          },
          {
            id: "confirm-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "confirmed",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Confirm decline optional if should not resolve",
          },
          {
            id: "confirm-decline-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Confirm decline open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "confirm-decline-multistep" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the initial confirm effect window restorable before optional missed-timing filtering",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "confirm-decline-open-fast", count: 1 },
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "confirm-decline-multistep", count: 1 },
            ],
            legalActionGroups: [openEffectGroup(0, "confirm-decline-open-fast", 1, 0)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "confirm-decline-optional-when", "turnOptional", 0, "open"),
              absentTriggerActivationGroup(0, "confirm-decline-optional-if", "turnOptional", 0, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "confirm-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "confirm-decline-optional-if" },
            ],

            legalActionCounts: { 0: 15, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },},
          after: {
            source: "edopro",
            note: "EDOPro keeps optional if confirmed triggers available while optional when confirmed triggers miss timing",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "confirm-decline-optional-if",
                eventName: "confirmed",
                eventCode: 1211,
                eventCardUid: "p0-deck-600-4",
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 7701,
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "confirm-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "confirm-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "confirm-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "confirm-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "confirm-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "confirm-decline-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "confirm-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "confirm-decline-open-fast" },
            ],
            logIncludes: ["Confirm decline multi step resolved"],

            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },},
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "confirm-decline-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if confirmed trigger decline restorable while optional when remains missed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "confirm-decline-optional-if",
                eventName: "confirmed",
                eventCode: 1211,
                eventCardUid: "p0-deck-600-4",
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 7701,
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "confirm-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "confirm-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "confirm-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "confirm-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "confirm-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "confirm-decline-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "confirm-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "confirm-decline-open-fast" },
            ],

            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },},
          after: {
            source: "edopro",
            note: "EDOPro exposes open fast effects after declining the surviving optional if confirmed trigger without resurrecting missed optional when triggers",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "confirm-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "confirm-decline-open-fast", 1, 2)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "confirm-decline-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "confirm-decline-optional-if", "turnOptional", 2, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "confirm-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "confirm-decline-optional-if" },
            ],
            logIncludes: ["Confirm decline multi step resolved", "confirm-decline-optional-if"],

            legalActionCounts: { 0: 14, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },},
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "confirm-decline-open-fast" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the confirmed post-decline open fast-effect window restorable after missed-timing filtering",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "confirm-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "confirm-decline-open-fast", 1, 2)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "confirm-decline-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "confirm-decline-optional-if", "turnOptional", 2, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "confirm-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "confirm-decline-optional-if" },
            ],
            logIncludes: ["Confirm decline multi step resolved", "confirm-decline-optional-if"],

            legalActionCounts: { 0: 14, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },},
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored post-decline open fast effect without resurrecting missed optional when triggers for confirmed events",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "confirm-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "confirm-decline-open-fast", 1, 3)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "confirm-decline-optional-when", "turnOptional", 3, "open"),
              absentTriggerActivationGroup(0, "confirm-decline-optional-if", "turnOptional", 3, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "confirm-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "confirm-decline-optional-if" },
            ],
            logIncludes: ["Confirm decline multi step resolved", "confirm-decline-optional-if", "Confirm decline open fast resolved"],

            legalActionCounts: { 0: 14, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },},
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after the restored confirmed post-decline open fast effect while optional when remains missed",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "confirm-decline-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "confirm-decline-open-fast", 1, 3)],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "confirm-decline-optional-when", "turnOptional", 3, "open"),
          absentTriggerActivationGroup(0, "confirm-decline-optional-if", "turnOptional", 3, "open"),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "confirm-decline-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "confirm-decline-optional-if" },
        ],
        logIncludes: ["Confirm decline multi step resolved", "confirm-decline-optional-if", "Confirm decline open fast resolved"],

        legalActionCounts: { 0: 14, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },},
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
