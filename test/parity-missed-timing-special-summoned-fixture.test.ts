import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity special-summoned missed timing fixture", () => {
  it("resolves optional if special-summoned triggers while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Special Summon Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Special Summoned Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Special Summoned Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Special Summon", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Special Summoned Body", kind: "monster", attack: 900, defense: 900 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "special-summoned missed timing activation fixture",
      options: { seed: 288, startingHandSize: 6 },
      decks: {
        0: { main: ["100", "400", "500", "800", "600", "700"] },
        1: { main: ["600", "600", "600", "600", "600", "600"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "600", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "special-summoned-activation-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            collectEventsOnResolve: [
              {
                collectEvent: "specialSummoned",
                eventCard: { player: 0, code: "600", location: "monsterZone" },
                eventIsLast: false,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 28801,
              },
            ],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Special summoned activation multi step resolved",
          },
          {
            id: "special-summoned-activation-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "specialSummoned",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Special summoned activation optional when should not resolve",
          },
          {
            id: "special-summoned-activation-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "specialSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Special summoned activation optional if resolved",
          },
          {
            id: "special-summoned-activation-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Special summoned activation open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "special-summoned-activation-multistep" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the initial special-summon-success effect window restorable before optional missed-timing filtering",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "special-summoned-activation-open-fast", count: 1 },
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "special-summoned-activation-multistep", count: 1 },
            ],
            legalActionGroups: [openEffectGroup(0, "special-summoned-activation-open-fast", 1, 0)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "special-summoned-activation-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "special-summoned-activation-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "special-summoned-activation-optional-when", "turnOptional", 0, "open"),
              absentTriggerActivationGroup(0, "special-summoned-activation-optional-if", "turnOptional", 0, "open"),
            ],
            legalActionCounts: { 0: 14, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps optional if special-summon-success triggers available while optional when special-summon-success triggers miss timing",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "special-summoned-activation-optional-if",
                eventName: "specialSummoned",
                eventCode: 1102,
                eventCardUid: "p0-deck-600-4",
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 28801,
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "special-summoned-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "special-summoned-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "special-summoned-activation-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "special-summoned-activation-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "special-summoned-activation-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "special-summoned-activation-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "special-summoned-activation-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "special-summoned-activation-open-fast" },
            ],
            logIncludes: ["Special summoned activation multi step resolved"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "special-summoned-activation-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if special-summon-success trigger activation restorable while optional when remains missed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "special-summoned-activation-optional-if",
                eventName: "specialSummoned",
                eventCode: 1102,
                eventCardUid: "p0-deck-600-4",
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 28801,
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "special-summoned-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "special-summoned-activation-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "special-summoned-activation-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "special-summoned-activation-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "special-summoned-activation-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "special-summoned-activation-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "special-summoned-activation-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "special-summoned-activation-open-fast" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the surviving optional if special-summon-success trigger and returns to open fast priority",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locationCounts: { graveyard: { "700": 1 }, hand: { "100": 1, "400": 1, "500": 1, "800": 1 }, monsterZone: { "600": 1 } },
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "special-summoned-activation-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "special-summoned-activation-open-fast", 1, 2)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "special-summoned-activation-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "special-summoned-activation-optional-if", "turnOptional", 2, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "special-summoned-activation-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "special-summoned-activation-optional-if" },
            ],
            logIncludes: ["Special summoned activation multi step resolved", "Special summoned activation optional if resolved"],
            legalActionCounts: { 0: 13, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the special-summon-success optional if trigger while optional when remains missed",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locationCounts: { graveyard: { "700": 1 }, hand: { "100": 1, "400": 1, "500": 1, "800": 1 }, monsterZone: { "600": 1 } },
        legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "special-summoned-activation-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "special-summoned-activation-open-fast", 1, 2)],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "special-summoned-activation-optional-when", "turnOptional", 2, "open"),
          absentTriggerActivationGroup(0, "special-summoned-activation-optional-if", "turnOptional", 2, "open"),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "special-summoned-activation-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "special-summoned-activation-optional-if" },
        ],
        logIncludes: ["Special summoned activation multi step resolved", "Special summoned activation optional if resolved"],
        legalActionCounts: { 0: 13, 1: 0 },
        legalActionGroupCounts: { 0: 4, 1: 0 },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
