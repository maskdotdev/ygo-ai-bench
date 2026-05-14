import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity normal-summoned missed timing decline fixture", () => {
  it("returns declined optional if normal-summoned triggers to open fast priority while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Normal Summon Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Normal Summoned Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Normal Summoned Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Normal Summon", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Normal Summoned Body", kind: "monster", attack: 900, defense: 900 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "normal-summoned missed timing decline open fast fixture",
      options: { seed: 291, startingHandSize: 6 },
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
            id: "normal-summoned-decline-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            collectEventsOnResolve: [
              {
                collectEvent: "normalSummoned",
                eventCard: { player: 0, code: "600", location: "monsterZone" },
                eventIsLast: false,
              },
            ],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Normal summoned decline multi step resolved",
          },
          {
            id: "normal-summoned-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Normal summoned decline optional when should not resolve",
          },
          {
            id: "normal-summoned-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Normal summoned decline optional if should not resolve",
          },
          {
            id: "normal-summoned-decline-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Normal summoned decline open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "normal-summoned-decline-multistep" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro keeps optional if normal-summon-success triggers available while optional when normal-summon-success triggers miss timing",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "normal-summoned-decline-optional-if", eventName: "normalSummoned", eventCode: 1100, eventCardUid: "p0-deck-600-4" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "normal-summoned-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "normal-summoned-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "normal-summoned-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "normal-summoned-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "normal-summoned-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "normal-summoned-decline-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "normal-summoned-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "normal-summoned-decline-open-fast" },
            ],
            logIncludes: ["Normal summoned decline multi step resolved"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "normal-summoned-decline-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if normal-summon-success trigger decline restorable while optional when remains missed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "normal-summoned-decline-optional-if", eventName: "normalSummoned", eventCode: 1100, eventCardUid: "p0-deck-600-4" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionGroups: [
              triggerActivationGroup(0, "normal-summoned-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "normal-summoned-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "normal-summoned-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "normal-summoned-decline-open-fast", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "normal-summoned-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "normal-summoned-decline-open-fast" },
            ],
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro returns to open fast priority after declining the surviving optional if normal-summon-success trigger",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locationCounts: { graveyard: { "700": 1 }, hand: { "100": 1, "400": 1, "500": 1, "800": 1 }, monsterZone: { "600": 1 } },
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summoned-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "normal-summoned-decline-open-fast", 1, 2)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "normal-summoned-decline-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "normal-summoned-decline-optional-if", "turnOptional", 2, "open"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summoned-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summoned-decline-optional-if" },
            ],
            logIncludes: ["Normal summoned decline multi step resolved"],
            legalActionCounts: { 0: 13, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns declined normal-summon-success optional if triggers to open fast priority without resurfacing the missed optional when trigger",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locationCounts: { graveyard: { "700": 1 }, hand: { "100": 1, "400": 1, "500": 1, "800": 1 }, monsterZone: { "600": 1 } },
        legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summoned-decline-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "normal-summoned-decline-open-fast", 1, 2)],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "normal-summoned-decline-optional-when", "turnOptional", 2, "open"),
          absentTriggerActivationGroup(0, "normal-summoned-decline-optional-if", "turnOptional", 2, "open"),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summoned-decline-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "normal-summoned-decline-optional-if" },
        ],
        legalActionCounts: { 0: 13, 1: 0 },
        legalActionGroupCounts: { 0: 4, 1: 0 },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
