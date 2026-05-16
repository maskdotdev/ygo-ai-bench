import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger-chain open fast-effect chain response fixture", () => {
  it("returns trigger-player response priority after the opponent chains to a selected trigger", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Chain Response Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Trigger Chain Response Success Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Trigger Chain Response Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Trigger Chain Response Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Trigger Chain Response Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain open fast chain response fixture",
      options: { seed: 312, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: ["500", "600", "500"] },
      },
      setup: {
        effects: [
          {
            id: "trigger-chain-response-success",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Trigger chain response success should not resolve yet",
          },
          {
            id: "trigger-chain-response-turn-chain-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger chain response turn chain quick should not resolve yet",
          },
          {
            id: "trigger-chain-response-opponent-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger chain response opponent chain quick should not resolve yet",
          },
          {
            id: "trigger-chain-response-opponent-open-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Trigger chain response opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "trigger-chain-response-success" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "trigger-chain-response-opponent-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored opponent priority before chaining to the selected trigger",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "trigger-chain-response-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-response-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "trigger-chain-response-opponent-chain-quick", 1, 2),
              chainPassGroup(1, 1, 2),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-response-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "trigger-chain-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "trigger-chain-response-turn-chain-quick", 2),
              absentChainEffectGroup(1, "trigger-chain-response-opponent-open-quick", 2),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro returns trigger-chain response priority to the trigger player after the opponent chains to the selected trigger",
        windowId: 3,
        windowKind: "chainResponse",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "trigger-chain-response-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
          { player: 1, effectId: "trigger-chain-response-opponent-chain-quick", sourceUid: "p1-deck-500-0" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-response-turn-chain-quick", count: 1 },
          { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(0, "trigger-chain-response-turn-chain-quick", 1, 3),
          chainPassGroup(0, 1, 3),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-response-opponent-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-response-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentChainEffectGroup(1, "trigger-chain-response-opponent-chain-quick", 3),
          absentChainEffectGroup(1, "trigger-chain-response-opponent-open-quick", 3),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
