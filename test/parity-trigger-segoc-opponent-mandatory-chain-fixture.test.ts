import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup, triggerActivationGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity SEGOC opponent mandatory chain fixture", () => {
  it("opens chain responses for opponent mandatory activations when a response exists", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Turn Mandatory", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Mandatory", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Turn Chain Quick After Mandatory", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent mandatory activation chain response SEGOC fixture",
      options: { seed: 58, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-segoc-turn-mandatory-before-opponent-chain",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "SEGOC turn mandatory before opponent chain resolved",
          },
          {
            id: "fixture-segoc-opponent-mandatory-chain",
            player: 1,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "SEGOC opponent mandatory chain resolved",
          },
          {
            id: "fixture-segoc-turn-mandatory-chain-response",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "SEGOC turn mandatory chain response resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-segoc-turn-mandatory-before-opponent-chain" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 1, { effectId: "fixture-segoc-opponent-mandatory-chain" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves the opponent mandatory SEGOC bucket before it opens a chain-response window",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "fixture-segoc-turn-mandatory-before-opponent-chain", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            pendingTriggers: [{ player: 1, effectId: "fixture-segoc-opponent-mandatory-chain", triggerBucket: "opponentMandatory", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            pendingTriggerBuckets: [{ player: 1, triggerBucket: "opponentMandatory" }],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [
              { type: "activateTrigger", player: 1, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-mandatory-chain", triggerBucket: "opponentMandatory", count: 1 },
            ],
            legalActionGroups: [triggerActivationGroup(1, "fixture-segoc-opponent-mandatory-chain", "opponentMandatory", 1, 2)],
            absentLegalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-mandatory-before-opponent-chain", triggerBucket: "turnMandatory" },
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-segoc-turn-mandatory-chain-response" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(0, "fixture-segoc-turn-mandatory-before-opponent-chain", "turnMandatory", 2, "triggerBucket"),
              absentWindowEffectGroup(0, "fixture-segoc-turn-mandatory-chain-response", 2, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro opens turn-player chain-response priority after an opponent mandatory trigger when a chain response exists",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "fixture-segoc-turn-mandatory-before-opponent-chain", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-segoc-opponent-mandatory-chain", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "fixture-segoc-turn-mandatory-chain-response", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "fixture-segoc-turn-mandatory-chain-response", 1, 3), chainPassGroup(0, 1, 3)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-segoc-turn-mandatory-chain-response" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the mandatory SEGOC chain-response window restorable before the turn player chains a quick effect",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "fixture-segoc-turn-mandatory-before-opponent-chain", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-segoc-opponent-mandatory-chain", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "fixture-segoc-turn-mandatory-chain-response", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "fixture-segoc-turn-mandatory-chain-response", 1, 3), chainPassGroup(0, 1, 3)],
            absentLegalActions: [
              { type: "activateTrigger", player: 1, windowId: 3, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-mandatory-chain" },
            ],
            absentLegalActionGroups: [
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-mandatory-chain", "opponentMandatory", 3, "triggerBucket"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the mandatory SEGOC chain after the turn player adds the only legal response",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(4)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-mandatory-chain-response" },
              { type: "activateTrigger", player: 1, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-mandatory-chain" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-segoc-turn-mandatory-chain-response", 4, "open"),
              absentTriggerActivationGroup(1, "fixture-segoc-opponent-mandatory-chain", "opponentMandatory", 4, "triggerBucket"),
            ],
            logIncludes: ["SEGOC turn mandatory chain response resolved", "SEGOC opponent mandatory chain resolved", "SEGOC turn mandatory before opponent chain resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves mandatory SEGOC trigger chains after the only turn-player chain response",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(4)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-segoc-turn-mandatory-chain-response" },
          { type: "activateTrigger", player: 1, windowId: 4, windowKind: "triggerBucket", effectId: "fixture-segoc-opponent-mandatory-chain" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-segoc-turn-mandatory-chain-response", 4, "open"),
          absentTriggerActivationGroup(1, "fixture-segoc-opponent-mandatory-chain", "opponentMandatory", 4, "triggerBucket"),
        ],
        logIncludes: ["SEGOC turn mandatory chain response resolved", "SEGOC opponent mandatory chain resolved", "SEGOC turn mandatory before opponent chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
