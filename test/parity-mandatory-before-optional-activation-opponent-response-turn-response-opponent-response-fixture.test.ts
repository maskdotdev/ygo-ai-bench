import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity mandatory before optional activation opponent-response turn-response opponent-response fixture", () => {
  it("returns trigger-player responses after the opponent responds to a trigger-player same-player trigger response", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Summon Source", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Mandatory Trigger", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Optional Trigger", kind: "monster", attack: 1500, defense: 1600 },
      { code: "500", name: "Opponent Chain Quick First", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Turn Chain Quick First", kind: "monster", attack: 600, defense: 600 },
      { code: "700", name: "Opponent Open Quick Filtered", kind: "monster", attack: 700, defense: 700 },
      { code: "800", name: "Opponent Chain Quick Second", kind: "monster", attack: 800, defense: 800 },
      { code: "900", name: "Turn Chain Quick Second", kind: "monster", attack: 900, defense: 900 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "mandatory before optional activation opponent response turn response opponent response fixture",
      options: { seed: 432, startingHandSize: 5 },
      decks: {
        0: { main: ["100", "300", "400", "600", "900"] },
        1: { main: ["500", "800", "700", "100", "100"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-opponent-turn-opponent-mandatory-first",
            player: 0,
            code: "300",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            optional: false,
            range: ["hand"],
            logMessage: "Opponent turn opponent mandatory trigger should not resolve yet",
          },
          {
            id: "fixture-opponent-turn-opponent-optional-second",
            player: 0,
            code: "400",
            location: "hand",
            event: "trigger",
            triggerEvent: "normalSummoned",
            triggerTiming: "if",
            range: ["hand"],
            logMessage: "Opponent turn opponent optional trigger should not resolve yet",
          },
          {
            id: "fixture-opponent-turn-opponent-opponent-first",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent turn opponent first opponent quick should not resolve yet",
          },
          {
            id: "fixture-opponent-turn-opponent-turn-first",
            player: 0,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent turn opponent first turn quick should not resolve yet",
          },
          {
            id: "fixture-opponent-turn-opponent-opponent-open-filtered",
            player: 1,
            code: "700",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Opponent turn opponent open quick should not resolve",
          },
          {
            id: "fixture-opponent-turn-opponent-opponent-second",
            player: 1,
            code: "800",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent turn opponent second opponent quick should not resolve yet",
          },
          {
            id: "fixture-opponent-turn-opponent-turn-second",
            player: 0,
            code: "900",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent turn opponent second turn quick should not resolve yet",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-opponent-turn-opponent-mandatory-first" })),
        makeScriptedStep(makeResponseSelector("activateTrigger", 0, { effectId: "fixture-opponent-turn-opponent-optional-second" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-turn-opponent-opponent-first" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-opponent-turn-opponent-turn-first" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-turn-opponent-opponent-second" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro restores opponent response priority after the trigger player responds to an opponent chain on selected same-player triggers",
            windowId: 5,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "fixture-opponent-turn-opponent-mandatory-first", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 0, effectId: "fixture-opponent-turn-opponent-optional-second", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
              { player: 1, effectId: "fixture-opponent-turn-opponent-opponent-first", sourceUid: "p1-deck-500-0" },
              { player: 0, effectId: "fixture-opponent-turn-opponent-turn-first", sourceUid: "p0-deck-600-3" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-turn-opponent-opponent-second", count: 1 },
              { type: "passChain", player: 1, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-turn-opponent-opponent-second", 1, 5),
              chainPassGroup(1, 1, 5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-turn-opponent-turn-first" },
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-turn-opponent-turn-second" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-turn-opponent-opponent-first" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-turn-opponent-opponent-open-filtered" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "fixture-opponent-turn-opponent-turn-first", 5),
              absentChainEffectGroup(0, "fixture-opponent-turn-opponent-turn-second", 5),
              absentChainEffectGroup(1, "fixture-opponent-turn-opponent-opponent-first", 5),
              absentWindowEffectGroup(1, "fixture-opponent-turn-opponent-opponent-open-filtered", 5, "chainResponse"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro returns response priority to the trigger player after the opponent responds to a trigger-player response on selected same-player mandatory and optional triggers",
        windowId: 6,
        windowKind: "chainResponse",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "fixture-opponent-turn-opponent-mandatory-first", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
          { player: 0, effectId: "fixture-opponent-turn-opponent-optional-second", eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
          { player: 1, effectId: "fixture-opponent-turn-opponent-opponent-first", sourceUid: "p1-deck-500-0" },
          { player: 0, effectId: "fixture-opponent-turn-opponent-turn-first", sourceUid: "p0-deck-600-3" },
          { player: 1, effectId: "fixture-opponent-turn-opponent-opponent-second", sourceUid: "p1-deck-800-1" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-turn-opponent-turn-second", count: 1 },
          { type: "passChain", player: 0, windowId: 6, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(0, "fixture-opponent-turn-opponent-turn-second", 1, 6),
          chainPassGroup(0, 1, 6),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-turn-opponent-turn-first" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-turn-opponent-opponent-first" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-turn-opponent-opponent-second" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-turn-opponent-opponent-open-filtered" },
        ],
        absentLegalActionGroups: [
          absentChainEffectGroup(0, "fixture-opponent-turn-opponent-turn-first", 6),
          absentChainEffectGroup(1, "fixture-opponent-turn-opponent-opponent-first", 6),
          absentChainEffectGroup(1, "fixture-opponent-turn-opponent-opponent-second", 6),
          absentWindowEffectGroup(1, "fixture-opponent-turn-opponent-opponent-open-filtered", 6, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
