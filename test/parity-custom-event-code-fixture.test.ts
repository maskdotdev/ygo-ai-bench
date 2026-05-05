import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity fixture event codes", () => {
  it("asserts custom event codes in fixture windows and final state", () => {
    const eventCode = 0x10000000 + 7;
    const cards: DuelCardData[] = [
      { code: "100", name: "Custom Event Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Matching Custom Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Wrong Custom Trigger", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Custom Event Body", kind: "monster", attack: 1200, defense: 1200 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "custom event code fixture",
      options: { seed: 49, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "300", "400", "500"] },
        1: { main: ["500", "500", "500", "500"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-raise-custom-event",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [
              {
                player: 0,
                code: "500",
                from: "hand",
                to: "graveyard",
                collectEvent: "customEvent",
                eventCode,
                eventPlayer: 1,
                eventValue: 77,
                eventReason: 64,
                eventReasonPlayer: 1,
                relatedEffectId: 7001,
              },
            ],
            logMessage: "Fixture custom event raised",
          },
          {
            id: "fixture-matching-custom-trigger",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerCode: eventCode,
            range: ["hand"],
            logMessage: "Fixture matching custom trigger resolved",
          },
          {
            id: "fixture-wrong-custom-trigger",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "customEvent",
            triggerCode: eventCode + 1,
            range: ["hand"],
            logMessage: "Wrong custom trigger should not resolve",
          },
          {
            id: "fixture-custom-chain-quick",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["graveyard"],
            logMessage: "Custom chain quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-raise-custom-event" }), {
          after: {
            source: "edopro",
            note: "EDOPro custom events preserve event code, player, value, reason, reason player, and related effect payload for trigger filtering",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              {
                player: 0,
                effectId: "fixture-matching-custom-trigger",
                eventName: "customEvent",
                eventCode,
                eventPlayer: 1,
                eventValue: 77,
                eventReason: 64,
                eventReasonPlayer: 1,
                relatedEffectId: 7001,
                eventCardUid: "p0-deck-500-3",
              },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            eventHistory: [
              { eventName: "chainActivating", eventCardUid: "p0-deck-100-0" },
              { eventName: "chaining", eventCardUid: "p0-deck-100-0" },
              { eventName: "chainSolving", eventCardUid: "p0-deck-100-0" },
              { eventName: "customEvent", eventCode, eventPlayer: 1, eventValue: 77, eventReason: 64, eventReasonPlayer: 1, relatedEffectId: 7001, eventCardUid: "p0-deck-500-3" },
              { eventName: "chainSolved" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-matching-custom-trigger", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-matching-custom-trigger", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "activateTrigger", player: 0, effectId: "fixture-wrong-custom-trigger" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                actions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-wrong-custom-trigger" }],
              },
            ],
            logIncludes: ["Fixture custom event raised"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-matching-custom-trigger" }), {
          snapshotRestore: true,
          after: {
            source: "edopro",
            note: "EDOPro carries custom event payload fields onto the activated trigger chain link",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 0,
            chain: [
              {
                player: 0,
                effectId: "fixture-matching-custom-trigger",
                eventName: "customEvent",
                eventCode,
                eventPlayer: 1,
                eventValue: 77,
                eventReason: 64,
                eventReasonPlayer: 1,
                relatedEffectId: 7001,
                eventCardUid: "p0-deck-500-3",
              },
            ],
            pendingTriggers: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "fixture-custom-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 2,
                windowKind: "chainResponse",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "fixture-custom-chain-quick", count: 1 }],
              },
              {
                player: 0,
                label: "Pass",
                windowId: 2,
                windowKind: "chainResponse",
                count: 1,
                actions: [{ type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: true,
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state preserves custom event payload history after the matching custom trigger resolves",
        windowId: 3,
        phase: "main1",
        waitingFor: 0,
        pendingTriggers: [],
        eventHistory: [
          { eventName: "chainActivating", eventCardUid: "p0-deck-100-0" },
          { eventName: "chaining", eventCardUid: "p0-deck-100-0" },
          { eventName: "chainSolving", eventCardUid: "p0-deck-100-0" },
          { eventName: "customEvent", eventCode, eventPlayer: 1, eventValue: 77, eventReason: 64, eventReasonPlayer: 1, relatedEffectId: 7001, eventCardUid: "p0-deck-500-3" },
          { eventName: "chainSolved" },
          { eventName: "chainActivating", eventCardUid: "p0-deck-300-1" },
          { eventName: "chaining", eventCardUid: "p0-deck-300-1" },
          { eventName: "chainSolving", eventCardUid: "p0-deck-300-1" },
          { eventName: "chainSolved" },
          { eventName: "chainEnded" },
        ],
        locations: { graveyard: ["500"], hand: ["100", "300", "400"] },
        logIncludes: ["Fixture matching custom trigger resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
