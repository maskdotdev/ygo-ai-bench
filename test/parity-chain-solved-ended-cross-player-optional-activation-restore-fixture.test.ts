import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, openEffectGroup, summonGroup, triggerActivationGroup, triggerDeclineGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity cross-player optional chain lifecycle activation restore fixture", () => {
  it("keeps deferred chainEnded buckets hidden until cross-player optional chainSolved activations finish", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Cross Optional Activation Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Optional Chain Solved Activator", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Optional Chain Solved Activator", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Deferred Chain Ended Activator", kind: "monster", attack: 1200, defense: 1200 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cross-player optional chain solved activation before chain ended restore fixture",
      options: { seed: 613, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-cross-optional-activation-starter",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            logMessage: "Cross optional activation starter resolved",
          },
          {
            id: "fixture-cross-chain-solved-turn-optional-activation",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainSolved",
            triggerTiming: "if",
            range: ["hand"],
            oncePerTurn: true,
            logMessage: "Cross chain solved turn optional activation resolved",
          },
          {
            id: "fixture-cross-chain-solved-opponent-optional-activation",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainSolved",
            triggerTiming: "if",
            range: ["hand"],
            oncePerTurn: true,
            logMessage: "Cross chain solved opponent optional activation resolved",
          },
          {
            id: "fixture-cross-chain-ended-after-optional-activations",
            player: 0,
            code: "500",
            location: "hand",
            event: "trigger",
            triggerEvent: "chainEnded",
            optional: false,
            triggerTiming: "if",
            range: ["hand"],
            oncePerTurn: true,
            logMessage: "Cross chain ended after optional activations resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-cross-optional-activation-starter" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro opens turn-player optional chainSolved buckets before opponent optional chainSolved buckets and defers chainEnded triggers",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [
              { player: 0, effectId: "fixture-cross-chain-solved-turn-optional-activation", eventName: "chainSolved", triggerBucket: "turnOptional", eventTriggerTiming: "if" },
              { player: 1, effectId: "fixture-cross-chain-solved-opponent-optional-activation", eventName: "chainSolved", triggerBucket: "opponentOptional", eventTriggerTiming: "if" },
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-chain-solved-turn-optional-activation", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-chain-solved-turn-optional-activation", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-cross-chain-solved-turn-optional-activation", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-cross-chain-solved-turn-optional-activation", "turnOptional", 1, 1),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-cross-chain-solved-opponent-optional-activation", "opponentOptional", 1, "triggerBucket"),
              absentTriggerActivationGroup(0, "fixture-cross-chain-ended-after-optional-activations", "turnMandatory", 1, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-chain-solved-opponent-optional-activation" },
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-cross-chain-ended-after-optional-activations" },
            ],
            logIncludes: ["Cross optional activation starter resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-cross-chain-solved-turn-optional-activation" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro keeps opponent optional chainSolved triggers ahead of deferred chainEnded buckets after a restored turn optional activation",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "fixture-cross-chain-solved-turn-optional-activation", eventName: "chainSolved", eventTriggerTiming: "if" }],
            pendingTriggers: [{ player: 1, effectId: "fixture-cross-chain-solved-opponent-optional-activation", eventName: "chainSolved", triggerBucket: "opponentOptional", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-cross-chain-solved-opponent-optional-activation", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-cross-chain-solved-opponent-optional-activation", triggerBucket: "opponentOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(1, "fixture-cross-chain-solved-opponent-optional-activation", "opponentOptional", 1, 2),
              triggerDeclineGroup(1, "fixture-cross-chain-solved-opponent-optional-activation", "opponentOptional", 1, 2),
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-cross-chain-solved-turn-optional-activation", "turnOptional", 2, "triggerBucket"),
              absentTriggerActivationGroup(0, "fixture-cross-chain-ended-after-optional-activations", "turnMandatory", 2, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-cross-chain-solved-turn-optional-activation" },
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-cross-chain-ended-after-optional-activations" },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-cross-chain-solved-opponent-optional-activation" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro collects deferred chainEnded buckets only after cross-player optional chainSolved activations resolve",
            windowId: 3,
            windowKind: "triggerBucket",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [{ player: 0, effectId: "fixture-cross-chain-ended-after-optional-activations", eventName: "chainEnded", triggerBucket: "turnMandatory", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-cross-chain-ended-after-optional-activations", triggerBucket: "turnMandatory", count: 1 },
            ],
            legalActionGroups: [triggerActivationGroup(0, "fixture-cross-chain-ended-after-optional-activations", "turnMandatory", 1, 3)],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-cross-chain-solved-turn-optional-activation", "turnOptional", 3, "triggerBucket"),
              absentTriggerActivationGroup(1, "fixture-cross-chain-solved-opponent-optional-activation", "opponentOptional", 3, "triggerBucket"),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-cross-chain-solved-turn-optional-activation" },
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-cross-chain-solved-opponent-optional-activation" },
            ],
            logIncludes: [
              "Cross chain solved turn optional activation resolved",
              "Cross chain solved opponent optional activation resolved",
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-cross-chain-ended-after-optional-activations" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns to open priority without resurrecting activated chainSolved buckets after deferred chainEnded resolves",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            legalActionCounts: { 0: 9, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-cross-optional-activation-starter", count: 1 },
              { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              openEffectGroup(0, "fixture-cross-optional-activation-starter", 1, 4),
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "normalSummon", player: 0, code: "500", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "500", location: "hand" },
              ], 1, 4),
              turnGroup(4),
            ],
            logIncludes: ["Cross chain ended after optional activations resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state preserves cross-player optional chainSolved activation progression before deferred chainEnded buckets",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        chainPasses: [],
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        legalActionCounts: { 0: 9, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-cross-optional-activation-starter", count: 1 },
          { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "500", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          openEffectGroup(0, "fixture-cross-optional-activation-starter", 1, 4),
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "300", location: "hand" },
            { type: "normalSummon", player: 0, code: "500", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "300", location: "hand" },
            { type: "setMonster", player: 0, code: "500", location: "hand" },
          ], 1, 4),
          turnGroup(4),
        ],
        logIncludes: [
          "Cross optional activation starter resolved",
          "Cross chain solved turn optional activation resolved",
          "Cross chain solved opponent optional activation resolved",
          "Cross chain ended after optional activations resolved",
        ],
      },
    };

    const result = runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
