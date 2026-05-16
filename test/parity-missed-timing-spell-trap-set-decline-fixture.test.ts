import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity spell/trap-set missed timing decline fixture", () => {
  it("returns declined optional if spell/trap-set triggers to open fast priority while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Spell Trap Set Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Spell Trap Set Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Spell Trap Set Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Spell Trap Set", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Spell Trap Set Body", kind: "spell" },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "spell/trap-set missed timing decline open fast fixture",
      options: { seed: 309, startingHandSize: 6 },
      decks: {
        0: { main: ["100", "400", "500", "800", "600", "700"] },
        1: { main: ["600", "600", "600", "600", "600", "600"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "600", from: "hand", to: "spellTrapZone" },
          { player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "spell-trap-set-decline-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            collectEventsOnResolve: [
              {
                collectEvent: "spellTrapSet",
                eventCard: { player: 0, code: "600", location: "spellTrapZone" },
                eventIsLast: false,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 30901,
              },
            ],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Spell trap set decline multi step resolved",
          },
          {
            id: "spell-trap-set-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "spellTrapSet",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Spell trap set decline optional when should not resolve",
          },
          {
            id: "spell-trap-set-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "spellTrapSet",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Spell trap set decline optional if should not resolve",
          },
          {
            id: "spell-trap-set-decline-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Spell trap set decline open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "spell-trap-set-decline-multistep" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro keeps optional if spell/trap-set triggers available while optional when spell/trap-set triggers miss timing",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "spell-trap-set-decline-optional-if",
                eventName: "spellTrapSet",
                eventCode: 1107,
                eventCardUid: "p0-deck-600-4",
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 30901,
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "spell-trap-set-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "spell-trap-set-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "spell-trap-set-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "spell-trap-set-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "spell-trap-set-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "spell-trap-set-decline-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "spell-trap-set-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "spell-trap-set-decline-open-fast" },
            ],
            logIncludes: ["Spell trap set decline multi step resolved"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "spell-trap-set-decline-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if spell/trap-set trigger decline restorable while optional when remains missed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "spell-trap-set-decline-optional-if",
                eventName: "spellTrapSet",
                eventCode: 1107,
                eventCardUid: "p0-deck-600-4",
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 30901,
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "spell-trap-set-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "spell-trap-set-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "spell-trap-set-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "spell-trap-set-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "spell-trap-set-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "spell-trap-set-decline-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "spell-trap-set-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "spell-trap-set-decline-open-fast" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro returns to open fast priority after declining the surviving optional if spell/trap-set trigger",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locationCounts: { graveyard: { "700": 1 }, hand: { "100": 1, "400": 1, "500": 1, "800": 1 }, spellTrapZone: { "600": 1 } },
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "spell-trap-set-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "spell-trap-set-decline-open-fast", 1, 2)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "spell-trap-set-decline-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "spell-trap-set-decline-optional-if", "turnOptional", 2, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "spell-trap-set-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "spell-trap-set-decline-optional-if" },
            ],
            logIncludes: ["Spell trap set decline multi step resolved"],
            legalActionCounts: { 0: 12, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns declined spell/trap-set optional if triggers to open fast priority without resurfacing the missed optional when trigger",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locationCounts: { graveyard: { "700": 1 }, hand: { "100": 1, "400": 1, "500": 1, "800": 1 }, spellTrapZone: { "600": 1 } },
        legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "spell-trap-set-decline-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "spell-trap-set-decline-open-fast", 1, 2)],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "spell-trap-set-decline-optional-when", "turnOptional", 2, "open"),
          absentTriggerActivationGroup(0, "spell-trap-set-decline-optional-if", "turnOptional", 2, "open"),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "spell-trap-set-decline-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "spell-trap-set-decline-optional-if" },
        ],
        legalActionCounts: { 0: 12, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
