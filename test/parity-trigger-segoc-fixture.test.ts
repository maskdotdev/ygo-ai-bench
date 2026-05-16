import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentTriggerActivationGroup,
  absentWindowEffectGroup,
  triggerActivationGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity SEGOC trigger fixtures", () => {
  it("returns opponent mandatory activations directly to open fast-effect priority when no chain response exists", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Mandatory", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Mandatory", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Turn Open Quick After Mandatory", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent mandatory activation open fast SEGOC fixture",
      options: { seed: 59, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-segoc-turn-mandatory-before-opponent-open",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "SEGOC turn mandatory before opponent open resolved",
          },
          {
            id: "fixture-segoc-opponent-mandatory-open",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "SEGOC opponent mandatory open resolved",
          },
          {
            id: "fixture-segoc-open-fast-after-opponent-mandatory",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "SEGOC open fast after opponent mandatory resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-segoc-turn-mandatory-before-opponent-open" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-segoc-opponent-mandatory-open" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves the opponent mandatory SEGOC bucket after the turn mandatory trigger is placed on chain",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "fixture-segoc-turn-mandatory-before-opponent-open", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggers: [{ player: 1, effectId: "fixture-segoc-opponent-mandatory-open", triggerBucket: "opponentMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentMandatory" }],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-mandatory-open", triggerBucket: "opponentMandatory", count: 1 },
            ],
            legalActionGroups: [triggerActivationGroup(1, "fixture-segoc-opponent-mandatory-open", "opponentMandatory", 1, 2)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-mandatory-before-opponent-open", triggerBucket: "turnMandatory" },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-open-fast-after-opponent-mandatory" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-segoc-turn-mandatory-before-opponent-open", "turnMandatory", 2, "triggerBucket"),
              absentWindowEffectGroup(0, "fixture-segoc-open-fast-after-opponent-mandatory", 2, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves mandatory SEGOC trigger chains immediately when no legal chain response exists",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory" },
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-mandatory-open" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-segoc-open-fast-after-opponent-mandatory", 3, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-mandatory-open", "opponentMandatory", 3, "triggerBucket"),
            ],
            logIncludes: ["SEGOC opponent mandatory open resolved", "SEGOC turn mandatory before opponent open resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-segoc-open-fast-after-opponent-mandatory" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps turn-player open fast priority restorable after mandatory SEGOC trigger chains resolve",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory", count: 1 }],
              },
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory" },
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-mandatory-open" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-segoc-open-fast-after-opponent-mandatory", 3, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-mandatory-open", "opponentMandatory", 3, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored open fast effect after an unresponded mandatory SEGOC chain",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory", count: 1 }],
              },
              turnGroup(4),
            ],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-mandatory-before-opponent-open" },
              { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-segoc-opponent-mandatory-open" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-segoc-turn-mandatory-before-opponent-open", "turnMandatory", 4, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-mandatory-open", "opponentMandatory", 4, "open"),
            ],
            logIncludes: ["SEGOC open fast after opponent mandatory resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to open priority after resolving the post-mandatory SEGOC open fast effect",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory", count: 1 },
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
            actions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-open-fast-after-opponent-mandatory", count: 1 }],
          },
          turnGroup(4),
        ],
        absentLegalActions: [
          { type: "activateTrigger", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-mandatory-before-opponent-open" },
          { type: "activateTrigger", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-segoc-opponent-mandatory-open" },
        ],
        absentLegalActionGroups: [
          absentTriggerActivationGroup(0, "fixture-segoc-turn-mandatory-before-opponent-open", "turnMandatory", 4, "open"),
          absentTriggerActivationGroup(1, "fixture-segoc-opponent-mandatory-open", "opponentMandatory", 4, "open"),
        ],
        logIncludes: ["SEGOC open fast after opponent mandatory resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
