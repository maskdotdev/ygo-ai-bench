import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  absentWindowEffectGroup,
  triggerActivationGroup,
  triggerDeclineGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity SEGOC opponent optional direct fixture", () => {
  it("returns opponent optional activations directly to open fast-effect priority when no chain response exists", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Optional", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Optional", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Turn Open Quick After SEGOC", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent optional activation open fast SEGOC fixture",
      options: { seed: 56, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-segoc-turn-optional-before-opponent-activation",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "SEGOC turn optional before opponent activation should not resolve",
          },
          {
            id: "fixture-segoc-opponent-optional-activation",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "SEGOC opponent optional activation resolved",
          },
          {
            id: "fixture-segoc-open-fast-after-opponent-activation",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "SEGOC open fast after opponent activation resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-segoc-turn-optional-before-opponent-activation" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves turn optional SEGOC priority before the turn player declines into the opponent optional bucket",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-segoc-turn-optional-before-opponent-activation", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
              { player: 1, effectId: "fixture-segoc-opponent-optional-activation", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-optional-before-opponent-activation", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-optional-before-opponent-activation", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-segoc-turn-optional-before-opponent-activation", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-segoc-turn-optional-before-opponent-activation", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-activation", triggerBucket: "opponentOptional" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-segoc-open-fast-after-opponent-activation" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "fixture-segoc-open-fast-after-opponent-activation", 1, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro hands SEGOC optional priority to the non-turn optional bucket after the turn optional bucket is declined",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            pendingTriggers: [{ player: 1, effectId: "fixture-segoc-opponent-optional-activation", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-activation", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-activation", triggerBucket: "opponentOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 1, 2),
              triggerDeclineGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 1, 2),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-open-fast-after-opponent-activation" }],
            absentLegalActionGroups: [absentWindowEffectGroup(0, "fixture-segoc-open-fast-after-opponent-activation", 2, "triggerBucket")],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-segoc-opponent-optional-activation" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the opponent optional SEGOC bucket restorable before an unresponded trigger activation",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            pendingTriggers: [{ player: 1, effectId: "fixture-segoc-opponent-optional-activation", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-activation", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-activation", triggerBucket: "opponentOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 1, 2),
              triggerDeclineGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 1, 2),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-optional-before-opponent-activation", triggerBucket: "turnOptional" },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-open-fast-after-opponent-activation" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-segoc-turn-optional-before-opponent-activation", "turnOptional", 2, "triggerBucket"),
              absentWindowEffectGroup(0, "fixture-segoc-open-fast-after-opponent-activation", 2, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the opponent optional trigger immediately when no legal chain response exists",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation", count: 1 },
              { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 3,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-activation" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 3, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-segoc-open-fast-after-opponent-activation", 3, "open"),
            ],
            logIncludes: ["fixture-segoc-turn-optional-before-opponent-activation", "SEGOC opponent optional activation resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-segoc-open-fast-after-opponent-activation" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro restores turn-player open fast-effect priority after an unresponded opponent optional trigger",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation", count: 1 },
              { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 3,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-activation" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 3, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-segoc-open-fast-after-opponent-activation", 3, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored open fast effect after an unresponded opponent optional SEGOC trigger",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation", count: 1 },
              { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 4,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation", count: 1 }],
              },
              turnGroup(4),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-optional-before-opponent-activation" },
              { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-segoc-opponent-optional-activation" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-segoc-turn-optional-before-opponent-activation", "turnOptional", 4, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 4, "open"),
            ],
            logIncludes: ["SEGOC open fast after opponent activation resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after resolving the post-SEGOC activation open fast effect",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation", count: 1 },
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 4,
            windowKind: "open",
            count: 1,
            actions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-activation", count: 1 }],
          },
          turnGroup(4),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-optional-before-opponent-activation" },
          { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-segoc-opponent-optional-activation" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "fixture-segoc-turn-optional-before-opponent-activation", "turnOptional", 4, "open"),
          absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-activation", "opponentOptional", 4, "open"),
        ],
        logIncludes: ["SEGOC open fast after opponent activation resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
