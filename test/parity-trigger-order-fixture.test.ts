import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  summonGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger ordering fixtures", () => {
  it("lets the trigger player choose between same-bucket mandatory triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "First Mandatory", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Second Mandatory", kind: "monster", attack: 1500, defense: 1600 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "same-player mandatory ordering fixture",
      options: { seed: 50, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "400"] },
        1: { main: ["100", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-first-mandatory",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "First mandatory resolved",
          },
          {
            id: "fixture-second-mandatory",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Second mandatory resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes initial open-priority summon actions before collecting same-player mandatory trigger ordering prompts",
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
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-first-mandatory" },
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-second-mandatory" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-first-mandatory", "turnMandatory", 0, "open"),
              absentTriggerActivationGroup(0, "fixture-second-mandatory", "turnMandatory", 0, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro lets the trigger player order multiple same-bucket mandatory triggers and does not offer decline actions",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-first-mandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
              { player: 0, effectId: "fixture-second-mandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
            ],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }],
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnMandatory" },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-first-mandatory", count: 1 },
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-mandatory", count: 1 },
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
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-first-mandatory", count: 1 },
                  { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-mandatory", count: 1 },
                ],
              },
            ],
            absentLegalActions: [
              { type: "declineTrigger", player: 0, effectId: "fixture-first-mandatory" },
              { type: "declineTrigger", player: 0, effectId: "fixture-second-mandatory" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                actions: [
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-first-mandatory" },
                  { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-mandatory" },
                ],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-second-mandatory" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro allows either same-bucket mandatory trigger to be selected first by its controller",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            triggerOrderPrompt: { type: "orderTriggers", player: 0, triggerBucket: "turnMandatory" },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-mandatory", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 1,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-second-mandatory", count: 1 }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps the selected mandatory trigger on chain while the remaining same-bucket trigger is ordered",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "fixture-second-mandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggers: [{ player: 0, effectId: "fixture-first-mandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }],
            triggerOrderPrompt: null,
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-first-mandatory", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Trigger Activations",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                count: 1,
                actions: [{ type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-first-mandatory", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "declineTrigger", player: 0, effectId: "fixture-first-mandatory" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Trigger Declines",
                windowId: 2,
                windowKind: "triggerBucket",
                triggerBucket: { player: 0, triggerBucket: "turnMandatory" },
                actions: [{ type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-first-mandatory" }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-first-mandatory" })),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state preserves the controller-selected same-bucket mandatory trigger order",
        windowId: 3,
        windowKind: "open",
        phase: "main1",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        eventHistory: [
          { eventName: "normalSummoning", eventCardUid: "p0-deck-100-0" },
          { eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
          { eventName: "chainActivating", eventCardUid: "p0-deck-400-2" },
          { eventName: "chaining", eventCardUid: "p0-deck-400-2" },
          { eventName: "chainActivating", eventCardUid: "p0-deck-300-1" },
          { eventName: "chaining", eventCardUid: "p0-deck-300-1" },
          { eventName: "chainSolving", eventCardUid: "p0-deck-300-1" },
          { eventName: "chainSolved" },
          { eventName: "chainSolving", eventCardUid: "p0-deck-400-2" },
          { eventName: "chainSolved" },
          { eventName: "chainEnded" },
        ],
        locations: { monsterZone: ["100"], hand: ["300", "400"] },
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(3)],
        logIncludes: ["Second mandatory resolved", "First mandatory resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
