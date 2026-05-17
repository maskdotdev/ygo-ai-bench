import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity attack-disabled missed timing decline fixture", () => {
  it("returns declined optional if attack-disabled triggers to open fast priority while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attack Disabled Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Attack Disabled Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Attack Disabled Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Attack Disabled", kind: "monster", attack: 500, defense: 500 },
      { code: "700", name: "Followup Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack-disabled missed timing decline open fast fixture",
      options: { seed: 348, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "400", "500", "800", "700"] },
        1: { main: ["700", "700", "700", "700", "700"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "attack-disabled-decline-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            collectEventsOnResolve: [
              {
                collectEvent: "attackDisabled",
                eventCode: 1142,
                eventIsLast: false,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 34801,
              },
            ],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Attack-disabled decline multi step resolved",
          },
          {
            id: "attack-disabled-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "attackDisabled",
            triggerCode: 1142,
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Attack-disabled decline optional when should not resolve",
          },
          {
            id: "attack-disabled-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "attackDisabled",
            triggerCode: 1142,
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Attack-disabled decline optional if should not resolve",
          },
          {
            id: "attack-disabled-decline-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Attack-disabled decline open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "attack-disabled-decline-multistep" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the initial attack-disabled effect window restorable before optional missed-timing filtering",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "attack-disabled-decline-open-fast", count: 1 },
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "attack-disabled-decline-multistep", count: 1 },
            ],
            legalActionGroups: [openEffectGroup(0, "attack-disabled-decline-open-fast", 1, 0)],
            legalActionCounts: { 0: 13, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps optional if attack-disabled triggers available while optional when attack-disabled triggers miss timing",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "attack-disabled-decline-optional-if",
                eventName: "attackDisabled",
                eventCode: 1142,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 34801,
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "attack-disabled-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "attack-disabled-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "attack-disabled-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "attack-disabled-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "attack-disabled-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "attack-disabled-decline-open-fast" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "attack-disabled-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "attack-disabled-decline-open-fast", 1, "triggerBucket"),
            ],
            logIncludes: ["Attack-disabled decline multi step resolved"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "attack-disabled-decline-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if attack-disabled trigger decline restorable while optional when remains missed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "attack-disabled-decline-optional-if",
                eventName: "attackDisabled",
                eventCode: 1142,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 34801,
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "attack-disabled-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "attack-disabled-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "attack-disabled-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "attack-disabled-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "attack-disabled-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "attack-disabled-decline-open-fast" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "attack-disabled-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "attack-disabled-decline-open-fast", 1, "triggerBucket"),
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro exposes open fast effects after declining the surviving optional if attack-disabled trigger",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "attack-disabled-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "attack-disabled-decline-open-fast", 1, 2)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "attack-disabled-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "attack-disabled-decline-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "attack-disabled-decline-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "attack-disabled-decline-optional-if", "turnOptional", 2, "open"),
            ],
            logIncludes: ["Attack-disabled decline multi step resolved", "attack-disabled-decline-optional-if"],
            legalActionCounts: { 0: 12, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "attack-disabled-decline-open-fast" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the attack-disabled post-decline open fast-effect window restorable after missed-timing filtering",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "attack-disabled-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "attack-disabled-decline-open-fast", 1, 2)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "attack-disabled-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "attack-disabled-decline-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "attack-disabled-decline-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "attack-disabled-decline-optional-if", "turnOptional", 2, "open"),
            ],
            logIncludes: ["Attack-disabled decline multi step resolved", "attack-disabled-decline-optional-if"],
            legalActionCounts: { 0: 12, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored post-decline open fast effect without resurrecting missed optional when triggers for attack-disabled events",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "attack-disabled-decline-open-fast", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "attack-disabled-decline-open-fast", 1, 3)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "attack-disabled-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "attack-disabled-decline-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "attack-disabled-decline-optional-when", "turnOptional", 3, "open"),
              absentTriggerActivationGroup(0, "attack-disabled-decline-optional-if", "turnOptional", 3, "open"),
            ],
            logIncludes: ["Attack-disabled decline multi step resolved", "attack-disabled-decline-optional-if", "Attack-disabled decline open fast resolved"],
            legalActionCounts: { 0: 12, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after the restored attack-disabled post-decline open fast effect while optional when remains missed",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "attack-disabled-decline-open-fast", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "attack-disabled-decline-open-fast", 1, 3)],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "attack-disabled-decline-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 3, windowKind: "open", effectId: "attack-disabled-decline-optional-if" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "attack-disabled-decline-optional-when", "turnOptional", 3, "open"),
          absentTriggerActivationGroup(0, "attack-disabled-decline-optional-if", "turnOptional", 3, "open"),
        ],
        logIncludes: ["Attack-disabled decline multi step resolved", "attack-disabled-decline-optional-if", "Attack-disabled decline open fast resolved"],
        legalActionCounts: { 0: 12, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
