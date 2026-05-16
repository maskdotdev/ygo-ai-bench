import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity mandatory before optional activation opponent-response turn-response chain fixture", () => {
  it("opens opponent responses after the trigger player responds to an opponent same-player trigger response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Mandatory Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Optional Trigger", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Opponent Chain Quick First", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Turn Chain Quick After Opponent", kind: "monster", attack: 600, defense: 600 },
      { code: "700", name: "Opponent Open Quick Filtered", kind: "monster", attack: 700, defense: 700 },
      { code: "800", name: "Opponent Chain Quick Second", kind: "monster", attack: 800, defense: 800 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "mandatory before optional activation opponent response turn response chain fixture",
      options: { seed: 431, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "300", "400", "600"] },
        1: { main: ["500", "800", "700", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-opponent-turn-chain-mandatory-first",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Opponent turn chain mandatory trigger should not resolve yet",
          },
          {
            id: "fixture-opponent-turn-chain-optional-second",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Opponent turn chain optional trigger should not resolve yet",
          },
          {
            id: "fixture-opponent-turn-chain-opponent-first",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent turn chain first opponent quick should not resolve yet",
          },
          {
            id: "fixture-opponent-turn-chain-turn-response",
            player: 0,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent turn chain turn quick should not resolve yet",
          },
          {
            id: "fixture-opponent-turn-chain-opponent-open-filtered",
            player: 1,
            code: "700",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Opponent turn chain opponent open quick should not resolve",
          },
          {
            id: "fixture-opponent-turn-chain-opponent-second",
            player: 1,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent turn chain second opponent quick should not resolve yet",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-opponent-turn-chain-mandatory-first" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-opponent-turn-chain-optional-second" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-turn-chain-opponent-first" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-opponent-turn-chain-turn-response" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro restores trigger-player response priority before they respond to an opponent chain on selected same-player triggers",
            windowId: 4,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "fixture-opponent-turn-chain-mandatory-first", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-opponent-turn-chain-optional-second", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-opponent-turn-chain-opponent-first", sourceUid: "p1-deck-500-0" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-turn-chain-turn-response", count: 1 },
              { type: "passChain", player: 0, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-opponent-turn-chain-turn-response", 1, 4),
              chainPassGroup(0, 1, 4),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-turn-chain-opponent-first" },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-turn-chain-opponent-second" },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-turn-chain-opponent-open-filtered" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(1, "fixture-opponent-turn-chain-opponent-first", 4),
              absentChainEffectGroup(1, "fixture-opponent-turn-chain-opponent-second", 4),
              absentWindowEffectGroup(1, "fixture-opponent-turn-chain-opponent-open-filtered", 4, "chainResponse"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro opens opponent chain responses after the trigger player responds to an opponent response on selected same-player mandatory and optional triggers",
        windowId: 5,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "fixture-opponent-turn-chain-mandatory-first", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
          { player: 0, effectId: "fixture-opponent-turn-chain-optional-second", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
          { player: 1, effectId: "fixture-opponent-turn-chain-opponent-first", sourceUid: "p1-deck-500-0" },
          { player: 0, effectId: "fixture-opponent-turn-chain-turn-response", sourceUid: "p0-deck-600-3" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-turn-chain-opponent-second", count: 1 },
          { type: "passChain", player: 1, windowId: 5, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "fixture-opponent-turn-chain-opponent-second", 1, 5),
          chainPassGroup(1, 1, 5),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-turn-chain-turn-response" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-turn-chain-opponent-first" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-turn-chain-opponent-open-filtered" },
        ],
        absentLegalActionGroups: [
          absentChainEffectGroup(0, "fixture-opponent-turn-chain-turn-response", 5),
          absentChainEffectGroup(1, "fixture-opponent-turn-chain-opponent-first", 5),
          absentWindowEffectGroup(1, "fixture-opponent-turn-chain-opponent-open-filtered", 5, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
