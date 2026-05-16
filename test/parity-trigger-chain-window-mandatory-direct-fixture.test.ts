import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger chain-window mandatory direct fixture", () => {
  it("resolves mandatory sibling trigger chains directly when no fast response exists", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Mandatory Chain Window Summon", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "First Mandatory Chain Window Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Second Mandatory Held Trigger", kind: "monster", attack: 1200, defense: 1200 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "mandatory trigger chain window direct sibling fixture",
      options: { seed: 185, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["100", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-direct-first-mandatory-chain-window-trigger",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Direct first mandatory trigger resolved",
          },
          {
            id: "fixture-direct-second-mandatory-held-trigger",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Direct second mandatory held trigger resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-direct-first-mandatory-chain-window-trigger" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps same-bucket mandatory trigger choices restorable before the first direct trigger is selected",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-direct-first-mandatory-chain-window-trigger", triggerBucket: "turnMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-direct-second-mandatory-held-trigger", triggerBucket: "turnMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnMandatory" },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-first-mandatory-chain-window-trigger", triggerBucket: "turnMandatory", count: 1 },
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-second-mandatory-held-trigger", triggerBucket: "turnMandatory", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-first-mandatory-chain-window-trigger", triggerBucket: "turnMandatory", count: 1 },
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-second-mandatory-held-trigger", triggerBucket: "turnMandatory", count: 1 },
                ],
              },
            ],
            absentLegalActions: [
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-first-mandatory-chain-window-trigger" },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-second-mandatory-held-trigger" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                actions: [
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-first-mandatory-chain-window-trigger" },
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-direct-second-mandatory-held-trigger" },
                ],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro holds the first selected mandatory trigger chain open while same-bucket mandatory siblings remain selectable",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-direct-first-mandatory-chain-window-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggers: [{ player: 0, effectId: "fixture-direct-second-mandatory-held-trigger", triggerBucket: "turnMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-mandatory-held-trigger", triggerBucket: "turnMandatory", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-mandatory-held-trigger", triggerBucket: "turnMandatory", count: 1 },
                ],
              },
            ],
            absentLegalActions: [{ type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-mandatory-held-trigger" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                actions: [{ type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-mandatory-held-trigger" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-direct-second-mandatory-held-trigger" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the held mandatory sibling trigger restorable before direct chain resolution",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-direct-first-mandatory-chain-window-trigger", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggers: [{ player: 0, effectId: "fixture-direct-second-mandatory-held-trigger", triggerBucket: "turnMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-mandatory-held-trigger", triggerBucket: "turnMandatory", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-mandatory-held-trigger", triggerBucket: "turnMandatory", count: 1 },
                ],
              },
            ],
            absentLegalActions: [{ type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-mandatory-held-trigger" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                actions: [{ type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-direct-second-mandatory-held-trigger" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the selected mandatory trigger chain immediately once sibling selection completes and no fast response exists",
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
            logIncludes: ["Direct first mandatory trigger resolved", "Direct second mandatory held trigger resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves selected mandatory sibling triggers directly when no fast response exists",
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
        logIncludes: ["Direct first mandatory trigger resolved", "Direct second mandatory held trigger resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
