import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  summonGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity optional trigger ordering fixture", () => {
  it("lets the trigger player choose and decline same-bucket optional triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Optional Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "First Optional", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Second Optional", kind: "monster", attack: 1500, defense: 1600 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "same-player optional ordering fixture",
      options: { seed: 51, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "400"] },
        1: { main: ["100", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-first-optional",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "First optional resolved",
          },
          {
            id: "fixture-second-optional",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Second optional resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes initial open-priority summon actions before collecting same-player optional trigger ordering prompts",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            locations: { hand: ["100", "300", "400"] },
            legalActionCounts: { 0: 8, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-first-optional" },
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-second-optional" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-first-optional", "turnOptional", 0, "open"),
              absentTriggerActivationGroup(0, "fixture-second-optional", "turnOptional", 0, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro lets the trigger player order same-bucket optional triggers and also exposes declines",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-first-optional", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
              { player: 0, effectId: "fixture-second-optional", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-first-optional", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-first-optional", triggerBucket: "turnOptional", count: 1 },
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-optional", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-optional", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-first-optional", triggerBucket: "turnOptional", count: 1 },
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-optional", triggerBucket: "turnOptional", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-first-optional", triggerBucket: "turnOptional", count: 1 },
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-optional", triggerBucket: "turnOptional", count: 1 },
                ],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-second-optional" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro allows either same-bucket optional trigger to be selected first by its controller",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-optional", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-optional", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-optional", triggerBucket: "turnOptional", count: 1 }],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnOptional" },
                count: 1,
                actions: [{ type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-optional", triggerBucket: "turnOptional", count: 1 }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps the selected optional trigger on chain while the remaining same-bucket optional trigger is offered",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-second-optional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggers: [{ player: 0, effectId: "fixture-first-optional", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            triggerOrderPrompt: null,
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-first-optional", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-first-optional", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                triggerOrderPrompt: null,
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-first-optional", triggerBucket: "turnOptional", count: 1 }],
              },
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnOptional" },
                triggerOrderPrompt: null,
                count: 1,
                actions: [{ type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-first-optional", triggerBucket: "turnOptional", count: 1 }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-first-optional" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves the selected optional trigger and leaves the declined same-bucket trigger unresolved",
        windowId: 3,
        phase: "main1",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        locations: { monsterZone: ["100"], hand: ["300", "400"] },
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(3)],
        logIncludes: ["Second optional resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
