import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Main Phase 2 open fast-effect pass handoff opponent response turn response chain resolution fixture", () => {
  it("resolves after the opponent chains from the Main Phase 2 turn-response window", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Main2 Handoff Opponent Turn Chain Resolution Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "130", name: "Main2 Handoff Opponent Turn Chain Resolution First Turn Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "140", name: "Main2 Handoff Opponent Turn Chain Resolution Second Turn Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "210", name: "Main2 Handoff Opponent Turn Chain Resolution First Opponent Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "220", name: "Main2 Handoff Opponent Turn Chain Resolution Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "230", name: "Main2 Handoff Opponent Turn Chain Resolution Second Opponent Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "main2 open fast pass handoff opponent response turn response chain resolution fixture",
      options: { seed: 295, startingHandSize: 3 },
      decks: {
        0: { main: ["110", "130", "140"] },
        1: { main: ["210", "230", "220"] },
      },
      setup: {
        effects: [
          {
            id: "main2-handoff-opponent-turn-chain-resolution-open-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 handoff opponent turn chain resolution open quick resolved",
          },
          {
            id: "main2-handoff-opponent-turn-chain-resolution-first-turn-quick",
            player: 0,
            code: "130",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff opponent turn chain resolution first turn quick resolved",
          },
          {
            id: "main2-handoff-opponent-turn-chain-resolution-second-turn-quick",
            player: 0,
            code: "140",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff opponent turn chain resolution second turn quick resolved",
          },
          {
            id: "main2-handoff-opponent-turn-chain-resolution-first-opponent-quick",
            player: 1,
            code: "210",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff opponent turn chain resolution first opponent quick resolved",
          },
          {
            id: "main2-handoff-opponent-turn-chain-resolution-second-opponent-quick",
            player: 1,
            code: "230",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff opponent turn chain resolution second opponent quick resolved",
          },
          {
            id: "main2-handoff-opponent-turn-chain-resolution-opponent-open-quick",
            player: 1,
            code: "220",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 handoff opponent turn chain resolution opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-handoff-opponent-turn-chain-resolution-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-handoff-opponent-turn-chain-resolution-first-turn-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "main2-handoff-opponent-turn-chain-resolution-first-opponent-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-handoff-opponent-turn-chain-resolution-second-turn-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "main2-handoff-opponent-turn-chain-resolution-second-opponent-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves Main Phase 2 handoff chains after the opponent chains from the response window reopened by the turn player's answer",
        phase: "main2",
        windowId: 8,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 8, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 8, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 8, windowKind: "open", code: "130", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 8, windowKind: "open", code: "140", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 8, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 8, windowKind: "open", code: "130", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 8, windowKind: "open", code: "140", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 8, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 8, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "110", location: "hand" },
            { type: "normalSummon", player: 0, code: "130", location: "hand" },
            { type: "normalSummon", player: 0, code: "140", location: "hand" },
            { type: "setMonster", player: 0, code: "110", location: "hand" },
            { type: "setMonster", player: 0, code: "130", location: "hand" },
            { type: "setMonster", player: 0, code: "140", location: "hand" },
          ], 1, 8),
          turnGroup(8),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "open", effectId: "main2-handoff-opponent-turn-chain-resolution-open-quick" },
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "open", effectId: "main2-handoff-opponent-turn-chain-resolution-first-turn-quick" },
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "open", effectId: "main2-handoff-opponent-turn-chain-resolution-second-turn-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "open", effectId: "main2-handoff-opponent-turn-chain-resolution-first-opponent-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "open", effectId: "main2-handoff-opponent-turn-chain-resolution-second-opponent-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "open", effectId: "main2-handoff-opponent-turn-chain-resolution-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "main2-handoff-opponent-turn-chain-resolution-open-quick", 8, "open"),
          absentWindowEffectGroup(0, "main2-handoff-opponent-turn-chain-resolution-first-turn-quick", 8, "open"),
          absentWindowEffectGroup(0, "main2-handoff-opponent-turn-chain-resolution-second-turn-quick", 8, "open"),
          absentWindowEffectGroup(1, "main2-handoff-opponent-turn-chain-resolution-first-opponent-quick", 8, "open"),
          absentWindowEffectGroup(1, "main2-handoff-opponent-turn-chain-resolution-second-opponent-quick", 8, "open"),
          absentWindowEffectGroup(1, "main2-handoff-opponent-turn-chain-resolution-opponent-open-quick", 8, "open"),
        ],
        logIncludes: [
          "Main2 handoff opponent turn chain resolution second opponent quick resolved",
          "Main2 handoff opponent turn chain resolution second turn quick resolved",
          "Main2 handoff opponent turn chain resolution first opponent quick resolved",
          "Main2 handoff opponent turn chain resolution first turn quick resolved",
          "Main2 handoff opponent turn chain resolution open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
