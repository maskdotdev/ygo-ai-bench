import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity sent-to-hand confirmed missed timing fixture", () => {
  it("resolves optional if sent-to-hand confirmed triggers while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Hand Confirm Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Hand Confirm Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Hand Confirm Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Hand Confirm", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Shown Hand Body", kind: "monster", attack: 900, defense: 900 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "sent-to-hand confirmed missed timing activation fixture",
      options: { seed: 83, startingHandSize: 6 },
      decks: {
        0: { main: ["100", "400", "500", "800", "600", "700"] },
        1: { main: ["600", "600", "600", "600", "600", "600"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "hand-confirm-activation-multistep",
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
                eventReasonEffectId: 8301,
                eventUids: ["p0-deck-600-4"],
              },
            ],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Hand confirm activation multi step resolved",
          },
          {
            id: "hand-confirm-activation-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToHandConfirmed",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Hand confirm activation optional when should not resolve",
          },
          {
            id: "hand-confirm-activation-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToHandConfirmed",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Hand confirm activation optional if resolved",
          },
          {
            id: "hand-confirm-activation-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Hand confirm activation open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "hand-confirm-activation-multistep" }), {
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
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "hand-confirm-activation-open-fast", count: 1 },
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "hand-confirm-activation-multistep", count: 1 },
            ],
            legalActionGroups: [openEffectGroup(0, "hand-confirm-activation-open-fast", 1, 0)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "hand-confirm-activation-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "hand-confirm-activation-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "hand-confirm-activation-optional-when", "turnOptional", 0, "open"),
              absentTriggerActivationGroup(0, "hand-confirm-activation-optional-if", "turnOptional", 0, "open"),
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
                effectId: "hand-confirm-activation-optional-if",
                eventName: "sentToHandConfirmed",
                eventCode: 1212,
                eventPlayer: 1,
                eventValue: 1,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 8301,
                eventUids: ["p0-deck-600-4"],
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "hand-confirm-activation-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "hand-confirm-activation-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "hand-confirm-activation-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "hand-confirm-activation-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-activation-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-activation-open-fast" },
            ],
            logIncludes: ["Hand confirm activation multi step resolved"],

            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },},
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "hand-confirm-activation-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if sent-to-hand confirmed trigger activation restorable while optional when remains missed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "hand-confirm-activation-optional-if",
                eventName: "sentToHandConfirmed",
                eventCode: 1212,
                eventPlayer: 1,
                eventValue: 1,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 8301,
                eventUids: ["p0-deck-600-4"],
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "hand-confirm-activation-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "hand-confirm-activation-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "hand-confirm-activation-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "hand-confirm-activation-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-activation-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "hand-confirm-activation-open-fast" },
            ],

            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },},
          after: {
            source: "edopro",
            note: "EDOPro resolves the surviving optional if sent-to-hand confirmed trigger and returns to open fast priority",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "hand-confirm-activation-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "hand-confirm-activation-open-fast", 1, 2)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "hand-confirm-activation-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "hand-confirm-activation-optional-if", "turnOptional", 2, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "hand-confirm-activation-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "hand-confirm-activation-optional-if" },
            ],
            logIncludes: ["Hand confirm activation multi step resolved", "Hand confirm activation optional if resolved"],

            legalActionCounts: { 0: 14, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },},
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the sent-to-hand confirmed optional if trigger while optional when remains missed",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "hand-confirm-activation-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "hand-confirm-activation-open-fast", 1, 2)],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "hand-confirm-activation-optional-when", "turnOptional", 2, "open"),
          absentTriggerActivationGroup(0, "hand-confirm-activation-optional-if", "turnOptional", 2, "open"),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "hand-confirm-activation-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "hand-confirm-activation-optional-if" },
        ],
        logIncludes: ["Hand confirm activation multi step resolved", "Hand confirm activation optional if resolved"],

        legalActionCounts: { 0: 14, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },},
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
