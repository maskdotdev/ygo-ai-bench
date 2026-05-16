import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { summonGroup, triggerActivationGroup, triggerDeclineGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity optional when timing fixtures", () => {
  it("keeps optional when triggers available when their event is last", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Single Step Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "600", name: "Moved Body", kind: "monster", attack: 900, defense: 900 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "optional when last-event fixture",
      options: { seed: 54, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "400", "600"] },
        1: { main: ["600", "600", "600"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-single-step-send",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [{ player: 0, code: "600", from: "hand", to: "graveyard", collectEvent: "sentToGraveyard" }],
            logMessage: "Single step send resolved",
          },
          {
            id: "fixture-optional-when",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Optional when resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-single-step-send" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the initial optional-when single-step send window restorable before exposing last-event triggers",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            phase: "main1",
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActionCounts: { 0: 9, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-single-step-send", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-single-step-send", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "normalSummon", player: 0, code: "600", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "600", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps optional when triggers available when their triggering event is the last event",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-optional-when", eventName: "sentToGraveyard", eventCardUid: "p0-deck-600-2", eventTriggerTiming: "when" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-optional-when", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-optional-when", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-optional-when", count: 1 }],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [{ type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-optional-when", count: 1 }],
              },
            ],
            logIncludes: ["Single step send resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-optional-when" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the last-event optional when trigger bucket restorable before trigger activation",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-optional-when", eventName: "sentToGraveyard", eventCardUid: "p0-deck-600-2", eventTriggerTiming: "when" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            locationCounts: { graveyard: { "600": 1 }, hand: { "100": 1, "400": 1 } },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-optional-when", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-optional-when", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-optional-when", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-optional-when", "turnOptional", 1, 1),
            ],
            logIncludes: ["Single step send resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the optional when trigger when its event did not miss timing",
        windowId: 2,
        phase: "main1",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        locationCounts: { graveyard: { "600": 1 }, hand: { "100": 1, "400": 1 } },
        legalActionCounts: { 0: 7, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-single-step-send", count: 1 },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
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
            actions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-single-step-send", count: 1 }],
          },
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
          ], 1, 2),
          turnGroup(2),
        ],
        logIncludes: ["Optional when resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
