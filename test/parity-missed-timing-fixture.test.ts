import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity missed timing fixtures", () => {
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
            moveCardsOnResolve: [
              { player: 0, code: "600", from: "hand", to: "graveyard", collectEvent: "sentToGraveyard" },
            ],
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
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro keeps optional when triggers available when their triggering event is the last event",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-optional-when", eventName: "sentToGraveyard", eventCardUid: "p0-deck-600-2" }],
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
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-optional-when", count: 1 }],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "declineTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-optional-when", count: 1 }],
              },
            ],
            logIncludes: ["Single step send resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-optional-when" }), {
          snapshotRestore: true,
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
        logIncludes: ["Optional when resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("keeps mandatory when triggers while optional when triggers miss timing", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Multi Step Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Mandatory When", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Optional If", kind: "monster", attack: 1200, defense: 1200 },
      { code: "600", name: "Moved Body", kind: "monster", attack: 900, defense: 900 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "mandatory when missed-timing fixture",
      options: { seed: 53, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "300", "400", "500", "600"] },
        1: { main: ["600", "600", "600", "600", "600"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-multistep-send",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [
              { player: 0, code: "600", from: "hand", to: "graveyard", collectEvent: "sentToGraveyard", eventIsLast: false },
              { player: 1, code: "600", from: "hand", to: "graveyard" },
            ],
            logMessage: "Multi step send resolved",
          },
          {
            id: "fixture-mandatory-when",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            triggerTiming: "when",
            optional: false,
            range: ["hand"],
            logMessage: "Mandatory when resolved",
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
            logMessage: "Optional when should not resolve",
          },
          {
            id: "fixture-optional-if",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Optional if resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-multistep-send" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro keeps mandatory when and optional if triggers while optional when misses timing after a non-last event",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-mandatory-when", eventName: "sentToGraveyard", eventCardUid: "p0-deck-600-4" },
              { player: 0, effectId: "fixture-optional-if", eventName: "sentToGraveyard", eventCardUid: "p0-deck-600-4" },
            ],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-mandatory-when", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-mandatory-when", count: 1 }],
              },
            ],
            absentLegalActions: [
              { type: "declineTrigger", player: 0, effectId: "fixture-mandatory-when" },
              { type: "activateTrigger", player: 0, effectId: "fixture-optional-when" },
              { type: "activateTrigger", player: 0, effectId: "fixture-optional-if" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                actions: [{ type: "declineTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-mandatory-when" }],
              },
            ],
            logIncludes: ["Multi step send resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-mandatory-when" }), {
          after: {
            source: "edopro",
            note: "EDOPro presents the remaining optional if trigger only after the mandatory when trigger is placed on chain",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-optional-if", eventName: "sentToGraveyard", eventCardUid: "p0-deck-600-4" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-optional-if", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-optional-if", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-optional-if", count: 1 }],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "declineTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-optional-if", count: 1 }],
              },
            ],
            logIncludes: ["Mandatory when resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-optional-if" }), {
          snapshotRestore: true,
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves the mandatory when and optional if triggers while the optional when trigger remains missed",
        windowId: 3,
        phase: "main1",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        eventHistory: [
          { eventName: "chainActivating", eventCardUid: "p0-deck-100-0" },
          { eventName: "chaining", eventCardUid: "p0-deck-100-0" },
          { eventName: "chainSolving", eventCardUid: "p0-deck-100-0" },
          { eventName: "sentToGraveyard", eventCardUid: "p0-deck-600-4" },
          { eventName: "chainSolved" },
          { eventName: "chainActivating", eventCardUid: "p0-deck-300-1" },
          { eventName: "chaining", eventCardUid: "p0-deck-300-1" },
          { eventName: "chainSolving", eventCardUid: "p0-deck-300-1" },
          { eventName: "chainSolved" },
          { eventName: "chainActivating", eventCardUid: "p0-deck-500-3" },
          { eventName: "chaining", eventCardUid: "p0-deck-500-3" },
          { eventName: "chainSolving", eventCardUid: "p0-deck-500-3" },
          { eventName: "chainSolved" },
          { eventName: "chainEnded" },
        ],
        locationCounts: { graveyard: { "600": 2 }, hand: { "100": 1, "300": 1, "400": 1, "500": 1 } },
        logIncludes: ["Mandatory when resolved", "Optional if resolved"],
        absentLegalActions: [{ type: "activateTrigger", player: 0, effectId: "fixture-optional-when" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Trigger Activations",
            windowKind: "triggerBucket",
            actions: [{ type: "activateTrigger", player: 0, windowKind: "triggerBucket", effectId: "fixture-optional-when" }],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
