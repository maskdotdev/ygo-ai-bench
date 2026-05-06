import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Main Phase 2 open fast-effect chain-response pass handoff opponent response fixture", () => {
  it("returns response priority to the turn player after the opponent responds to a reopened Main Phase 2 handoff window", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Main2 Chain Handoff Opponent Response Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "130", name: "Main2 Chain Handoff Opponent Response First Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "140", name: "Main2 Chain Handoff Opponent Response Second Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "150", name: "Main2 Chain Handoff Opponent Response Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "210", name: "Main2 Chain Handoff Opponent Response Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "220", name: "Main2 Chain Handoff Opponent Response Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "230", name: "Main2 Chain Handoff Opponent Response Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "240", name: "Main2 Chain Handoff Opponent Response Opponent Third Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "main2 open fast chain response pass handoff opponent response fixture",
      options: { seed: 281, startingHandSize: 4 },
      decks: {
        0: { main: ["110", "130", "140", "150"] },
        1: { main: ["210", "230", "240", "220"] },
      },
      setup: {
        effects: [
          {
            id: "main2-chain-handoff-opponent-response-open-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 chain handoff opponent response open quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-opponent-response-first-turn-chain-quick",
            player: 0,
            code: "130",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff opponent response first turn chain quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-opponent-response-second-turn-chain-quick",
            player: 0,
            code: "140",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff opponent response second turn chain quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-opponent-response-opponent-first-chain-quick",
            player: 1,
            code: "210",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff opponent response opponent first chain quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-opponent-response-opponent-second-chain-quick",
            player: 1,
            code: "230",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff opponent response opponent second chain quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-opponent-response-opponent-third-chain-quick",
            player: 1,
            code: "240",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff opponent response opponent third chain quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-opponent-response-opponent-open-quick",
            player: 1,
            code: "220",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 chain handoff opponent response opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-chain-handoff-opponent-response-open-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "main2-chain-handoff-opponent-response-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "main2-chain-handoff-opponent-response-opponent-second-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-chain-handoff-opponent-response-first-turn-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "main2-chain-handoff-opponent-response-opponent-third-chain-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps Main Phase 2 active and returns response priority to the turn player after the opponent uses the response window reopened by the turn player's handoff response",
        phase: "main2",
        windowId: 8,
        windowKind: "chainResponse",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "main2-chain-handoff-opponent-response-open-quick", sourceUid: "p0-deck-110-0" },
          { player: 1, effectId: "main2-chain-handoff-opponent-response-opponent-first-chain-quick", sourceUid: "p1-deck-210-0" },
          { player: 1, effectId: "main2-chain-handoff-opponent-response-opponent-second-chain-quick", sourceUid: "p1-deck-230-1" },
          { player: 0, effectId: "main2-chain-handoff-opponent-response-first-turn-chain-quick", sourceUid: "p0-deck-130-1" },
          { player: 1, effectId: "main2-chain-handoff-opponent-response-opponent-third-chain-quick", sourceUid: "p1-deck-240-2" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "main2-chain-handoff-opponent-response-second-turn-chain-quick", count: 1 },
          { type: "passChain", player: 0, windowId: 8, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(0, "main2-chain-handoff-opponent-response-second-turn-chain-quick", 1, 8),
          chainPassGroup(0, 1, 8),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "main2-chain-handoff-opponent-response-open-quick" },
          { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "main2-chain-handoff-opponent-response-first-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "main2-chain-handoff-opponent-response-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "main2-chain-handoff-opponent-response-opponent-second-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "main2-chain-handoff-opponent-response-opponent-third-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "main2-chain-handoff-opponent-response-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "main2-chain-handoff-opponent-response-open-quick", 8, "chainResponse"),
          absentWindowEffectGroup(0, "main2-chain-handoff-opponent-response-first-turn-chain-quick", 8, "chainResponse"),
          absentWindowEffectGroup(1, "main2-chain-handoff-opponent-response-opponent-first-chain-quick", 8, "chainResponse"),
          absentWindowEffectGroup(1, "main2-chain-handoff-opponent-response-opponent-second-chain-quick", 8, "chainResponse"),
          absentWindowEffectGroup(1, "main2-chain-handoff-opponent-response-opponent-third-chain-quick", 8, "chainResponse"),
          absentWindowEffectGroup(1, "main2-chain-handoff-opponent-response-opponent-open-quick", 8, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
