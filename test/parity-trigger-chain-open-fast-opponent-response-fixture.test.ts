import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, chainEffectGroup, chainPassGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger-chain open fast-effect opponent response fixture", () => {
  it("resolves opponent chain responses after trigger-player pass handoff chains", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Fast Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Summon Success Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Chain Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Opponent Chain Quick After Trigger", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain pass handoff opponent response fixture",
      options: { seed: 266, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: ["500", "500", "500"] },
      },
      setup: {
        effects: [
          {
            id: "trigger-pass-opponent-response-success",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Pass opponent response trigger resolved",
          },
          {
            id: "trigger-pass-opponent-response-turn-chain-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Pass opponent response turn chain quick resolved",
          },
          {
            id: "trigger-pass-opponent-response-opponent-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Pass opponent response opponent chain quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "trigger-pass-opponent-response-success" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "trigger-pass-opponent-response-turn-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored trigger-player priority before chaining from the opponent-passed response window",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "trigger-pass-opponent-response-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" }],
            chainPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "trigger-pass-opponent-response-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "trigger-pass-opponent-response-turn-chain-quick", 1, 3),
              chainPassGroup(0, 1, 3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-pass-opponent-response-opponent-chain-quick" },
            ],
            absentLegalActionGroups: [absentChainEffectGroup(1, "trigger-pass-opponent-response-opponent-chain-quick", 3)],
          },
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent another chain-response window after the trigger player chains from pass handoff",
            windowId: 4,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [
              { player: 0, effectId: "trigger-pass-opponent-response-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "trigger-pass-opponent-response-turn-chain-quick", sourceUid: "p0-deck-300-2" },
            ],
            chainPasses: [],
            pendingTriggers: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "trigger-pass-opponent-response-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "trigger-pass-opponent-response-opponent-chain-quick", 1, 4), chainPassGroup(1, 1, 4)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "trigger-pass-opponent-response-opponent-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored opponent priority before the opponent responds to the trigger player's handoff chain",
            windowId: 4,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "trigger-pass-opponent-response-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "trigger-pass-opponent-response-turn-chain-quick", sourceUid: "p0-deck-300-2" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "trigger-pass-opponent-response-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "trigger-pass-opponent-response-opponent-chain-quick", 1, 4),
              chainPassGroup(1, 1, 4),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "trigger-pass-opponent-response-turn-chain-quick" },
            ],
            absentLegalActionGroups: [absentChainEffectGroup(0, "trigger-pass-opponent-response-turn-chain-quick", 4)],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the trigger pass-handoff chain after the opponent adds the only remaining response",
            windowId: 5,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            pendingTriggers: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(5)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-opponent-chain-quick" },
              { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "200", location: "hand" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 5,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-turn-chain-quick" }],
              },
              {
                player: 1,
                label: "Effects",
                windowId: 5,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-opponent-chain-quick" }],
              },
            ],
            logIncludes: [
              "Pass opponent response opponent chain quick resolved",
              "Pass opponent response turn chain quick resolved",
              "Pass opponent response trigger resolved",
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro returns to turn-player open priority after the opponent responds to the trigger pass-handoff chain",
        windowId: 5,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        chainPasses: [],
        pendingTriggers: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(5)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-opponent-chain-quick" },
          { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "200", location: "hand" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 5,
            windowKind: "open",
            actions: [{ type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-turn-chain-quick" }],
          },
          {
            player: 1,
            label: "Effects",
            windowId: 5,
            windowKind: "open",
            actions: [{ type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "trigger-pass-opponent-response-opponent-chain-quick" }],
          },
        ],
        logIncludes: [
          "Pass opponent response opponent chain quick resolved",
          "Pass opponent response turn chain quick resolved",
          "Pass opponent response trigger resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
