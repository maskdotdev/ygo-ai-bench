import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity turn-started missed timing fixture", () => {
  it("keeps optional if triggers while optional when turn-started triggers miss timing", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Turn Start Boundary Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Turn Start Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Turn Start Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "700", name: "Turn Start Boundary Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "turn-started missed timing fixture",
      options: { seed: 214, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "400", "500", "700"] },
        1: { main: ["700", "700", "700", "700"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "turn-started-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            collectEventsOnResolve: [
              {
                collectEvent: "turnStarted",
                eventIsLast: false,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 21401,
              },
            ],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Turn-started multi step resolved",
          },
          {
            id: "turn-started-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "turnStarted",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Turn-started optional when should not resolve",
          },
          {
            id: "turn-started-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "turnStarted",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Turn-started optional if resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "turn-started-multistep" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the open ignition effect restorable before the turn-started event checks missed timing",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "turn-started-multistep", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "turn-started-multistep", 1, 0)],
            legalActionCounts: { 0: 10, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro drops optional when turn-started triggers when that event is not the final operation boundary, while optional if remains available",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "turn-started-optional-if",
                eventName: "turnStarted",
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 21401,
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "turn-started-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "turn-started-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "turn-started-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "turn-started-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "turn-started-optional-when" }],
            absentLegalActionGroups: [absentTriggerActivationGroup(0, "turn-started-optional-when", "turnOptional", 1, "triggerBucket")],
            logIncludes: ["Turn-started multi step resolved"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "turn-started-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if turn-started trigger restorable without resurrecting the missed optional when trigger",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "turn-started-optional-if",
                eventName: "turnStarted",
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 21401,
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "turn-started-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "turn-started-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "turn-started-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "turn-started-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "turn-started-optional-when" }],
            absentLegalActionGroups: [absentTriggerActivationGroup(0, "turn-started-optional-when", "turnOptional", 1, "triggerBucket")],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the surviving optional if turn-started trigger after restore without resurrecting missed optional when triggers",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "turn-started-multistep", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "turn-started-multistep", 1, 2)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "turn-started-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "turn-started-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "turn-started-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "turn-started-optional-if", "turnOptional", 2, "open"),
            ],
            logIncludes: ["Turn-started optional if resolved"],
            legalActionCounts: { 0: 9, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the optional if turn-started trigger without resurrecting the missed optional when trigger",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locationCounts: { graveyard: { "700": 1 }, hand: { "100": 1, "400": 1, "500": 1 } },
        legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "turn-started-multistep", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "turn-started-multistep", 1, 2)],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "turn-started-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "turn-started-optional-if" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "turn-started-optional-when", "turnOptional", 2, "open"),
          absentTriggerActivationGroup(0, "turn-started-optional-if", "turnOptional", 2, "open"),
        ],
        logIncludes: ["Turn-started optional if resolved"],
        legalActionCounts: { 0: 9, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
