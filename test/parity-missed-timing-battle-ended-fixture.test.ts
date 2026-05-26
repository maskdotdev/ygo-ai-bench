import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle-ended missed timing fixture", () => {
  it("resolves optional if battle-ended triggers while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Ended Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Battle Ended Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Battle Ended Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Battle Ended", kind: "monster", attack: 500, defense: 500 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "battle-ended missed timing activation fixture",
      options: { seed: 343, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "400", "500", "800", "700"] },
        1: { main: ["700", "700", "700", "700", "700"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "battle-ended-activation-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            collectEventsOnResolve: [
              {
                collectEvent: "battleEnded",
                eventCode: 1137,
                eventIsLast: false,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 34301,
              },
            ],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Battle-ended activation multi step resolved",
          },
          {
            id: "battle-ended-activation-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "battleEnded",
            triggerCode: 1137,
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Battle-ended activation optional when should not resolve",
          },
          {
            id: "battle-ended-activation-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "battleEnded",
            triggerCode: 1137,
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Battle-ended activation optional if resolved",
          },
          {
            id: "battle-ended-activation-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Battle-ended activation open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "battle-ended-activation-multistep" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the initial battle-ended effect window restorable before optional missed-timing filtering",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "battle-ended-activation-open-fast", count: 1 },
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "battle-ended-activation-multistep", count: 1 },
            ],
            legalActionGroups: [openEffectGroup(0, "battle-ended-activation-open-fast", 1, 0)],
            legalActionCounts: { 0: 13, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps optional if battle-ended triggers available while optional when battle-ended triggers miss timing",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "battle-ended-activation-optional-if",
                eventName: "battleEnded",
                eventCode: 1137,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 34301,
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            eventHistory: [
              { eventName: "chainActivating", eventCardUid: "p0-deck-100-0" },
              { eventName: "chaining", eventCardUid: "p0-deck-100-0" },
              { eventName: "chainSolving", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleEnded", eventCode: 1137, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: "p0-deck-100-0", eventReasonEffectId: 34301 },
              { eventName: "chainSolved" },
            ],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "battle-ended-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "battle-ended-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "battle-ended-activation-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "battle-ended-activation-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "battle-ended-activation-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "battle-ended-activation-open-fast" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "battle-ended-activation-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "battle-ended-activation-open-fast", 1, "triggerBucket"),
            ],
            logIncludes: ["Battle-ended activation multi step resolved"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "battle-ended-activation-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if battle-ended trigger activation restorable while optional when remains missed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "battle-ended-activation-optional-if",
                eventName: "battleEnded",
                eventCode: 1137,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 34301,
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "battle-ended-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "battle-ended-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "battle-ended-activation-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "battle-ended-activation-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "battle-ended-activation-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "battle-ended-activation-open-fast" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "battle-ended-activation-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "battle-ended-activation-open-fast", 1, "triggerBucket"),
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the surviving optional if battle-ended trigger and returns to open fast priority",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "battle-ended-activation-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "battle-ended-activation-open-fast", 1, 2)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "battle-ended-activation-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "battle-ended-activation-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "battle-ended-activation-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "battle-ended-activation-optional-if", "turnOptional", 2, "open"),
            ],
            logIncludes: ["Battle-ended activation multi step resolved", "Battle-ended activation optional if resolved"],
            legalActionCounts: { 0: 12, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the battle-ended optional if trigger while optional when remains missed",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "battle-ended-activation-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "battle-ended-activation-open-fast", 1, 2)],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "battle-ended-activation-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "battle-ended-activation-optional-if" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "battle-ended-activation-optional-when", "turnOptional", 2, "open"),
          absentTriggerActivationGroup(0, "battle-ended-activation-optional-if", "turnOptional", 2, "open"),
        ],
        logIncludes: ["Battle-ended activation multi step resolved", "Battle-ended activation optional if resolved"],
        legalActionCounts: { 0: 12, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
