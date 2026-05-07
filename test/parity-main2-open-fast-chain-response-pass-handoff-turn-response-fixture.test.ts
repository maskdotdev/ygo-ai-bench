import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Main Phase 2 open fast-effect chain-response pass handoff turn response fixture", () => {
  it("resolves turn-player responses after the opponent chains from a Main Phase 2 handoff window", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Main2 Chain Handoff Turn Response Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "130", name: "Main2 Chain Handoff Turn Response Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "140", name: "Main2 Chain Handoff Turn Response Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "210", name: "Main2 Chain Handoff Turn Response Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "220", name: "Main2 Chain Handoff Turn Response Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "230", name: "Main2 Chain Handoff Turn Response Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "main2 open fast chain response pass handoff turn response fixture",
      options: { seed: 278, startingHandSize: 3 },
      decks: {
        0: { main: ["110", "130", "140"] },
        1: { main: ["210", "230", "220"] },
      },
      setup: {
        effects: [
          {
            id: "main2-chain-handoff-turn-response-open-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 chain handoff turn response open quick resolved",
          },
          {
            id: "main2-chain-handoff-turn-response-chain-quick",
            player: 0,
            code: "130",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff turn response chain quick resolved",
          },
          {
            id: "main2-chain-handoff-turn-response-opponent-first-chain-quick",
            player: 1,
            code: "210",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff turn response opponent first chain quick resolved",
          },
          {
            id: "main2-chain-handoff-turn-response-opponent-second-chain-quick",
            player: 1,
            code: "230",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff turn response opponent second chain quick resolved",
          },
          {
            id: "main2-chain-handoff-turn-response-opponent-open-quick",
            player: 1,
            code: "220",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 chain handoff turn response opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-chain-handoff-turn-response-open-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "main2-chain-handoff-turn-response-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "main2-chain-handoff-turn-response-opponent-second-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-chain-handoff-turn-response-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro lets the turn player respond from the restored Main Phase 2 opponent response handoff",
            phase: "main2",
            windowId: 6,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "main2-chain-handoff-turn-response-open-quick", sourceUid: "p0-deck-110-0" },
              { player: 1, effectId: "main2-chain-handoff-turn-response-opponent-first-chain-quick", sourceUid: "p1-deck-210-0" },
              { player: 1, effectId: "main2-chain-handoff-turn-response-opponent-second-chain-quick", sourceUid: "p1-deck-230-1" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "main2-chain-handoff-turn-response-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "main2-chain-handoff-turn-response-chain-quick", 1, 6),
              chainPassGroup(0, 1, 6),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "main2-chain-handoff-turn-response-open-quick" },
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "main2-chain-handoff-turn-response-opponent-first-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "main2-chain-handoff-turn-response-opponent-second-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "main2-chain-handoff-turn-response-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "main2-chain-handoff-turn-response-open-quick", 6, "chainResponse"),
              absentChainEffectGroup(1, "main2-chain-handoff-turn-response-opponent-first-chain-quick", 6),
              absentChainEffectGroup(1, "main2-chain-handoff-turn-response-opponent-second-chain-quick", 6),
              absentWindowEffectGroup(1, "main2-chain-handoff-turn-response-opponent-open-quick", 6, "chainResponse"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps Main Phase 2 active and resolves the open fast-effect chain after the turn player responds to the opponent's chain-response pass-handoff chain link",
        phase: "main2",
        windowId: 7,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 8, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 7, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 7, windowKind: "open", code: "130", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 7, windowKind: "open", code: "140", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 7, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 7, windowKind: "open", code: "130", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 7, windowKind: "open", code: "140", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 7, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 7, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "110", location: "hand" },
            { type: "normalSummon", player: 0, code: "130", location: "hand" },
            { type: "normalSummon", player: 0, code: "140", location: "hand" },
            { type: "setMonster", player: 0, code: "110", location: "hand" },
            { type: "setMonster", player: 0, code: "130", location: "hand" },
            { type: "setMonster", player: 0, code: "140", location: "hand" },
          ], 1, 7),
          turnGroup(7),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "open", effectId: "main2-chain-handoff-turn-response-open-quick" },
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "open", effectId: "main2-chain-handoff-turn-response-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "open", effectId: "main2-chain-handoff-turn-response-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "main2-chain-handoff-turn-response-open-quick", 7, "open"),
          absentWindowEffectGroup(0, "main2-chain-handoff-turn-response-chain-quick", 7, "open"),
          absentWindowEffectGroup(1, "main2-chain-handoff-turn-response-opponent-open-quick", 7, "open"),
        ],
        logIncludes: [
          "Main2 chain handoff turn response chain quick resolved",
          "Main2 chain handoff turn response opponent second chain quick resolved",
          "Main2 chain handoff turn response opponent first chain quick resolved",
          "Main2 chain handoff turn response open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
