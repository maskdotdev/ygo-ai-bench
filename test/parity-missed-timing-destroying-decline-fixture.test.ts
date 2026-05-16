import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  absentWindowEffectGroup,
  summonGroup,
  triggerActivationGroup,
  triggerDeclineGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity destroying missed timing decline fixture", () => {
  it("returns declined optional if destroying triggers to open fast priority while optional when remains missed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Destroying Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Destroying Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Destroying Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "800", name: "Open Quick After Destroying", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Destroying Body", kind: "monster", attack: 900, defense: 900 },
      { code: "700", name: "After Destroying Body", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "destroying missed timing decline fixture",
      options: { seed: 287, startingHandSize: 6 },
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
            id: "destroying-decline-multistep",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [
              { player: 0, code: "600", from: "monsterZone", to: "graveyard", collectEvent: "destroying", eventIsLast: false, eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: "p0-deck-100-0", eventReasonEffectId: 28701 },
              { player: 0, code: "700", from: "monsterZone", to: "graveyard" },
            ],
            logMessage: "Destroying decline multi step resolved",
          },
          {
            id: "destroying-decline-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "destroying",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Destroying decline optional when should not resolve",
          },
          {
            id: "destroying-decline-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "destroying",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Destroying decline optional if should not resolve",
          },
          {
            id: "destroying-decline-open-fast",
            player: 0,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Destroying decline open fast resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "destroying-decline-multistep" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro keeps optional if EVENT_DESTROY triggers available while optional when EVENT_DESTROY triggers miss timing",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "destroying-decline-optional-if", eventName: "destroying", eventCode: 1010, eventCardUid: "p0-deck-600-4", eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: "p0-deck-100-0", eventReasonEffectId: 28701 }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "destroying-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "destroying-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "destroying-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "destroying-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "destroying-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "destroying-decline-open-fast" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "destroying-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "destroying-decline-open-fast", 1, "triggerBucket"),
            ],
            logIncludes: ["Destroying decline multi step resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "destroying-decline-optional-if" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the surviving optional if EVENT_DESTROY decline restorable while optional when remains missed",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "destroying-decline-optional-if", eventName: "destroying", eventCode: 1010, eventCardUid: "p0-deck-600-4", eventReason: 0x40, eventReasonPlayer: 0, eventReasonCardUid: "p0-deck-100-0", eventReasonEffectId: 28701 }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "destroying-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "destroying-decline-optional-if", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "destroying-decline-optional-if", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "destroying-decline-optional-if", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "destroying-decline-optional-when" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "destroying-decline-open-fast" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "destroying-decline-optional-when", "turnOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "destroying-decline-open-fast", 1, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns to open fast priority after declining the surviving optional if EVENT_DESTROY trigger",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locationCounts: { graveyard: { "600": 1, "700": 1 }, hand: { "100": 1, "400": 1, "500": 1, "800": 1 } },
            legalActionCounts: { 0: 12, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-open-fast", count: 1 },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-multistep", count: 1 },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "800", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "800", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 2,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-open-fast", count: 1 },
                  { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-multistep", count: 1 },
                ],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "normalSummon", player: 0, code: "500", location: "hand" },
                { type: "normalSummon", player: 0, code: "800", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "500", location: "hand" },
                { type: "setMonster", player: 0, code: "800", location: "hand" },
              ], 1, 2),
              turnGroup(2),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-optional-if" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "open",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-optional-when" },
                  { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-optional-if" },
                ],
              },
            ],
            logIncludes: ["Destroying decline multi step resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns declined EVENT_DESTROY optional if triggers to open fast priority without resurfacing the missed optional when trigger",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        locationCounts: { graveyard: { "600": 1, "700": 1 }, hand: { "100": 1, "400": 1, "500": 1, "800": 1 } },
        legalActionCounts: { 0: 12, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-open-fast", count: 1 },
          { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-multistep", count: 1 },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "800", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "800", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 2,
            windowKind: "open",
            count: 1,
            actions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-open-fast", count: 1 },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-multistep", count: 1 },
            ],
          },
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "normalSummon", player: 0, code: "500", location: "hand" },
            { type: "normalSummon", player: 0, code: "800", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "500", location: "hand" },
            { type: "setMonster", player: 0, code: "800", location: "hand" },
          ], 1, 2),
          turnGroup(2),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-optional-when" },
          { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-optional-if" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Trigger Activations",
            windowId: 2,
            windowKind: "open",
            triggerBucket: { player: 0, triggerBucket: "turnOptional" },
            actions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-optional-when" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: "destroying-decline-optional-if" },
            ],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
