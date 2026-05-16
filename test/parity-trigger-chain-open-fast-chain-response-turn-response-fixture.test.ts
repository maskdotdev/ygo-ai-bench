import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity trigger-chain open fast-effect chain response turn response fixture", () => {
  it("opens opponent responses after the trigger player responds to an opponent trigger-chain response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Trigger Chain Turn Response Summon", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Trigger Chain Turn Response Success Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Trigger Chain Turn Response Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Trigger Chain Turn Response Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Trigger Chain Turn Response Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "800", name: "Trigger Chain Turn Response Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "trigger chain open fast chain response turn response fixture",
      options: { seed: 314, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "300"] },
        1: { main: ["500", "800", "600"] },
      },
      setup: {
        effects: [
          {
            id: "trigger-chain-turn-response-success",
            player: 0,
            code: "200",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Trigger chain turn response success should not resolve yet",
          },
          {
            id: "trigger-chain-turn-response-turn-chain-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger chain turn response turn chain quick should not resolve yet",
          },
          {
            id: "trigger-chain-turn-response-opponent-first-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger chain turn response opponent first chain quick should not resolve yet",
          },
          {
            id: "trigger-chain-turn-response-opponent-open-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Trigger chain turn response opponent open quick should not resolve",
          },
          {
            id: "trigger-chain-turn-response-opponent-second-chain-quick",
            player: 1,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Trigger chain turn response opponent second chain quick should not resolve yet",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "trigger-chain-turn-response-success" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "trigger-chain-turn-response-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "trigger-chain-turn-response-turn-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored trigger-player priority before answering the opponent's trigger-chain response",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "trigger-chain-turn-response-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
              { player: 1, effectId: "trigger-chain-turn-response-opponent-first-chain-quick", sourceUid: "p1-deck-500-0" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-turn-response-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "trigger-chain-turn-response-turn-chain-quick", 1, 3),
              chainPassGroup(0, 1, 3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-turn-response-opponent-first-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-turn-response-opponent-second-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "trigger-chain-turn-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(1, "trigger-chain-turn-response-opponent-first-chain-quick", 3),
              absentChainEffectGroup(1, "trigger-chain-turn-response-opponent-second-chain-quick", 3),
              absentWindowEffectGroup(1, "trigger-chain-turn-response-opponent-open-quick", 3, "chainResponse"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro opens opponent chain responses after the trigger player responds to an opponent response on the selected trigger chain",
        windowId: 4,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "trigger-chain-turn-response-success", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0", eventTriggerTiming: "if" },
          { player: 1, effectId: "trigger-chain-turn-response-opponent-first-chain-quick", sourceUid: "p1-deck-500-0" },
          { player: 0, effectId: "trigger-chain-turn-response-turn-chain-quick", sourceUid: "p0-deck-300-2" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "trigger-chain-turn-response-opponent-second-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 4, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "trigger-chain-turn-response-opponent-second-chain-quick", 1, 4),
          chainPassGroup(1, 1, 4),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "trigger-chain-turn-response-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "trigger-chain-turn-response-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "trigger-chain-turn-response-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentChainEffectGroup(0, "trigger-chain-turn-response-turn-chain-quick", 4),
          absentChainEffectGroup(1, "trigger-chain-turn-response-opponent-first-chain-quick", 4),
          absentWindowEffectGroup(1, "trigger-chain-turn-response-opponent-open-quick", 4, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
