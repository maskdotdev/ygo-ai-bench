import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity phase-changed missed timing fixture", () => {
  it("keeps optional if triggers while optional when phase-changed triggers miss timing", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Phase Change Boundary Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Phase Change Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Phase Change Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "700", name: "Phase Change Boundary Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "phase-changed missed timing fixture",
      options: { seed: 215, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "400", "500", "700"] },
        1: { main: ["700", "700", "700", "700"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "phase-changed-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            collectEventsOnResolve: [
              {
                collectEvent: "phaseChanged",
                eventIsLast: false,
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 21501,
              },
            ],
            moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
            logMessage: "Phase-changed multi step resolved",
          },
          {
            id: "phase-changed-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "phaseChanged",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Phase-changed optional when should not resolve",
          },
          {
            id: "phase-changed-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "phaseChanged",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Phase-changed optional if resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "phase-changed-multistep" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the open ignition effect restorable before the phase-changed event checks missed timing",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "phase-changed-multistep", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "phase-changed-multistep", 1, 0)],
            legalActionCounts: { 0: 10, 1: 0 },
            legalActionGroupCounts: { 0: 4, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro drops optional when phase-changed triggers when that event is not the final operation boundary, while optional if remains available",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "phase-changed-optional-if",
                eventName: "phaseChanged",
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 21501,
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "phase-changed-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "phase-changed-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "phase-changed-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "phase-changed-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "phase-changed-optional-when" }],
            absentLegalActionGroups: [absentTriggerActivationGroup(0, "phase-changed-optional-when", "turnOptional", 1, "triggerBucket")],
            logIncludes: ["Phase-changed multi step resolved"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "phase-changed-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if phase-changed trigger restorable without resurrecting the missed optional when trigger",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "phase-changed-optional-if",
                eventName: "phaseChanged",
                eventReason: 0x40,
                eventReasonPlayer: 0,
                eventReasonCardUid: "p0-deck-100-0",
                eventReasonEffectId: 21501,
                eventTriggerTiming: "if",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "phase-changed-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "phase-changed-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "phase-changed-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "phase-changed-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "phase-changed-optional-when" }],
            absentLegalActionGroups: [absentTriggerActivationGroup(0, "phase-changed-optional-when", "turnOptional", 1, "triggerBucket")],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the surviving optional if phase-changed trigger after restore without resurrecting missed optional when triggers",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "phase-changed-multistep", count: 1 }],
            legalActionGroups: [openEffectGroup(0, "phase-changed-multistep", 1, 2)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "phase-changed-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "phase-changed-optional-if" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "phase-changed-optional-when", "turnOptional", 2, "open"),
              absentTriggerActivationGroup(0, "phase-changed-optional-if", "turnOptional", 2, "open"),
            ],
            logIncludes: ["Phase-changed optional if resolved"],
            legalActionCounts: { 0: 9, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the optional if phase-changed trigger without resurrecting the missed optional when trigger",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locationCounts: { graveyard: { "700": 1 }, hand: { "100": 1, "400": 1, "500": 1 } },
        legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "phase-changed-multistep", count: 1 }],
        legalActionGroups: [openEffectGroup(0, "phase-changed-multistep", 1, 2)],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "phase-changed-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "phase-changed-optional-if" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "phase-changed-optional-when", "turnOptional", 2, "open"),
          absentTriggerActivationGroup(0, "phase-changed-optional-if", "turnOptional", 2, "open"),
        ],
        logIncludes: ["Phase-changed optional if resolved"],
        legalActionCounts: { 0: 9, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
