import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger chain-window optional direct fixture", () => {
  it("resolves optional sibling trigger chains directly when no fast response exists", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Chain Window Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "First Chain Window Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Second Held Trigger", kind: "monster", attack: 1200, defense: 1200 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain window direct sibling fixture",
      options: { seed: 184, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["100", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-direct-first-chain-window-trigger",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Direct first trigger resolved",
          },
          {
            id: "fixture-direct-second-held-trigger",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Direct second held trigger resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-direct-first-chain-window-trigger" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps same-bucket optional trigger choices restorable before the first direct trigger is selected",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-direct-first-chain-window-trigger", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
              { player: 0, effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-first-chain-window-trigger", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-first-chain-window-trigger", triggerBucket: "turnOptional", count: 1 },
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-first-chain-window-trigger", triggerBucket: "turnOptional", count: 1 },
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-first-chain-window-trigger", triggerBucket: "turnOptional", count: 1 },
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", count: 1 },
                ],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro holds the first selected trigger chain open while same-bucket sibling optional triggers remain selectable",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-direct-first-chain-window-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggers: [{ player: 0, effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", count: 1 },
                ],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-direct-second-held-trigger" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the held optional sibling trigger restorable before direct chain resolution",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-direct-first-chain-window-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggers: [{ player: 0, effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-held-trigger", triggerBucket: "turnOptional", count: 1 },
                ],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the selected optional trigger chain immediately once sibling selection completes and no fast response exists",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(3)],
            logIncludes: ["Direct first trigger resolved", "Direct second held trigger resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves selected optional sibling triggers directly when no fast response exists",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(3)],
        logIncludes: ["Direct first trigger resolved", "Direct second held trigger resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
