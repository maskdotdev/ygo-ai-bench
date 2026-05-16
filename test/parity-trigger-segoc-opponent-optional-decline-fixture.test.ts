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

describe("EDOPro parity SEGOC opponent optional decline fixture", () => {
  it("returns opponent optional declines to turn-player open fast-effect priority", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Optional", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Optional", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Turn Open Quick After SEGOC", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent optional decline open fast SEGOC fixture",
      options: { seed: 55, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-segoc-turn-optional-decline",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "SEGOC turn optional should not resolve",
          },
          {
            id: "fixture-segoc-opponent-optional-decline",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "SEGOC opponent optional should not resolve",
          },
          {
            id: "fixture-segoc-open-fast-after-opponent-decline",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "SEGOC open fast after opponent decline resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps initial open priority restorable before creating optional SEGOC buckets",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 9, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "500", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "normalSummon", player: 0, code: "500", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "500", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-segoc-turn-optional-decline" },
              { type: "activateTrigger", player: 1, windowId: 0, windowKind: "open", effectId: "fixture-segoc-opponent-optional-decline" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-segoc-turn-optional-decline", "turnOptional", 0, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 0, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro presents turn-player optional triggers before non-turn optional triggers during SEGOC",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-segoc-turn-optional-decline", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
              { player: 1, effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-optional-decline", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-optional-decline", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-segoc-turn-optional-decline", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-segoc-turn-optional-decline", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional" },
              { type: "activateEffect", player: 0, effectId: "fixture-segoc-open-fast-after-opponent-decline" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "fixture-segoc-open-fast-after-opponent-decline", 1, "triggerBucket"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: "fixture-segoc-turn-optional-decline" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves turn optional SEGOC priority before the turn player declines",
            windowId: 1,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [
              { player: 0, effectId: "fixture-segoc-turn-optional-decline", triggerBucket: "turnOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
              { player: 1, effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" , eventTriggerTiming: "if"},
            ],
            pendingTriggerBuckets: [
              { player: 0, triggerBucket: "turnOptional" },
              { player: 1, triggerBucket: "opponentOptional" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-optional-decline", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-optional-decline", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-segoc-turn-optional-decline", "turnOptional", 1, 1),
              triggerDeclineGroup(0, "fixture-segoc-turn-optional-decline", "turnOptional", 1, 1),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: "fixture-segoc-open-fast-after-opponent-decline" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 1, "triggerBucket"),
              absentWindowEffectGroup(0, "fixture-segoc-open-fast-after-opponent-decline", 1, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro hands SEGOC optional priority to the non-turn optional bucket after the turn optional bucket is declined",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            pendingTriggers: [{ player: 1, effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 1, 2),
              triggerDeclineGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 1, 2),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-open-fast-after-opponent-decline" }],
            absentLegalActionGroups: [absentWindowEffectGroup(0, "fixture-segoc-open-fast-after-opponent-decline", 2, "triggerBucket")],
          },
        }),
        makeScriptedStep(makeResponseSelector("declineTrigger", 1, { effectId: "fixture-segoc-opponent-optional-decline" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the opponent optional SEGOC bucket restorable before the opponent declines",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            pendingTriggers: [{ player: 1, effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentOptional" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional", count: 1 },
              { type: "declineTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-decline", triggerBucket: "opponentOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 1, 2),
              triggerDeclineGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 1, 2),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-optional-decline", triggerBucket: "turnOptional" },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-open-fast-after-opponent-decline" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-segoc-turn-optional-decline", "turnOptional", 2, "triggerBucket"),
              absentWindowEffectGroup(0, "fixture-segoc-open-fast-after-opponent-decline", 2, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns to turn-player open fast-effect priority after the non-turn optional bucket is declined",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-decline" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 3, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-segoc-open-fast-after-opponent-decline", 3, "open"),
            ],
            logIncludes: ["fixture-segoc-turn-optional-decline", "fixture-segoc-opponent-optional-decline"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-segoc-open-fast-after-opponent-decline" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro restores turn-player open fast-effect priority after both optional SEGOC buckets are declined",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-optional-decline" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 3, "triggerBucket"),
              absentWindowEffectGroup(1, "fixture-segoc-open-fast-after-opponent-decline", 3, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored open fast effect after both SEGOC optional buckets are declined",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 }],
              },
              turnGroup(4),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-optional-decline" },
              { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-segoc-opponent-optional-decline" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-segoc-turn-optional-decline", "turnOptional", 4, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 4, "open"),
            ],
            logIncludes: ["SEGOC open fast after opponent decline resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after the post-SEGOC open fast effect resolves",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 },
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
            actions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-decline", count: 1 }],
          },
          turnGroup(4),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-optional-decline" },
          { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-segoc-opponent-optional-decline" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "fixture-segoc-turn-optional-decline", "turnOptional", 4, "open"),
          absentTriggerActivationGroup(1, "fixture-segoc-opponent-optional-decline", "opponentOptional", 4, "open"),
        ],
        logIncludes: ["SEGOC open fast after opponent decline resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
