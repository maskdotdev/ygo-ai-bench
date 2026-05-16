import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { chainEffectGroup, chainPassGroup, summonGroup, triggerActivationGroup, triggerDeclineGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity optional when chain response fixture", () => {
  it("opens chain responses for optional when triggers when their event is last", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Single Step Starter", kind: "monster", attack: 1800, defense: 1200 },
      { code: "400", name: "Optional When", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Opponent Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Moved Body", kind: "monster", attack: 900, defense: 900 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "optional when last-event chain response fixture",
      options: { seed: 56, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "400", "600"] },
        1: { main: ["500", "600", "600"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-single-step-send-chain",
            player: 0,
            code: "100",
            location: "hand",
            event: "ignition",
            range: ["hand"],
            moveCardsOnResolve: [{ player: 0, code: "600", from: "hand", to: "graveyard", collectEvent: "sentToGraveyard" }],
            logMessage: "Single step send chain resolved",
          },
          {
            id: "fixture-optional-when-chain",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "sentToGraveyard",
            triggerTiming: "when",
            range: ["hand"],
            logMessage: "Optional when chain resolved",
          },
          {
            id: "fixture-opponent-chain-after-optional-when",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent chain after optional when resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-single-step-send-chain" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-optional-when-chain" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the last-event optional when trigger bucket restorable before opening chain responses",
            windowId: 2,
            windowKind: "triggerBucket",
            waitingFor: 0,
            pendingTriggers: [{ player: 0, effectId: "fixture-optional-when-chain", eventName: "sentToGraveyard", eventCardUid: "p0-deck-600-2", eventTriggerTiming: "when" }],
            pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-optional-when-chain", triggerBucket: "turnOptional", count: 1 },
              { type: "declineTrigger", player: 0, windowId: 2, windowKind: "triggerBucket", effectId: "fixture-optional-when-chain", triggerBucket: "turnOptional", count: 1 },
            ],
            legalActionGroups: [
              triggerActivationGroup(0, "fixture-optional-when-chain", "turnOptional", 1, 2),
              triggerDeclineGroup(0, "fixture-optional-when-chain", "turnOptional", 1, 2),
            ],
            logIncludes: ["Single step send chain resolved"],
          },
          after: {
            source: "edopro",
            note: "EDOPro opens opponent chain-response priority after a last-event optional when trigger when a response exists",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "fixture-optional-when-chain", eventName: "sentToGraveyard", eventCardUid: "p0-deck-600-2", eventTriggerTiming: "when" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "fixture-opponent-chain-after-optional-when", count: 1 },
              { type: "passChain", player: 1, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "fixture-opponent-chain-after-optional-when", 1, 3), chainPassGroup(1, 1, 3)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-chain-after-optional-when" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps opponent chain-response priority restorable after the optional when trigger is placed on chain",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "fixture-optional-when-chain", eventName: "sentToGraveyard", eventCardUid: "p0-deck-600-2", eventTriggerTiming: "when" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "fixture-opponent-chain-after-optional-when", count: 1 },
              { type: "passChain", player: 1, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "fixture-opponent-chain-after-optional-when", 1, 3), chainPassGroup(1, 1, 3)],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the last-event optional when trigger chain after the opponent adds the only legal response",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            legalActionCounts: { 0: 7, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-single-step-send-chain", count: 1 },
              { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "400", location: "hand", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-single-step-send-chain", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
              ], 1, 4),
              turnGroup(4),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-opponent-chain-after-optional-when" }],
            absentLegalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 4,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 1, windowId: 4, windowKind: "open", effectId: "fixture-opponent-chain-after-optional-when" }],
              },
            ],
            logIncludes: ["Opponent chain after optional when resolved", "Optional when chain resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state resolves a responded last-event optional when trigger chain to open priority",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        legalActionCounts: { 0: 7, 1: 0 },
        legalActionGroupCounts: { 0: 3, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-single-step-send-chain", count: 1 },
          { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "400", location: "hand", count: 1 },
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
            actions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "fixture-single-step-send-chain", count: 1 }],
          },
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
          ], 1, 4),
          turnGroup(4),
        ],
        logIncludes: ["Opponent chain after optional when resolved", "Optional when chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
