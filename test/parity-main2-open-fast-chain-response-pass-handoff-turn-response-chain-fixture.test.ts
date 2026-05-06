import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Main Phase 2 open fast-effect chain-response pass handoff turn response chain fixture", () => {
  it("opens opponent responses after the turn player responds to Main Phase 2 handoff chains", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Main2 Chain Handoff Turn Response Chain Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "130", name: "Main2 Chain Handoff Turn Response Chain Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "140", name: "Main2 Chain Handoff Turn Response Chain Turn Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "150", name: "Main2 Chain Handoff Turn Response Chain Turn Extra", kind: "monster", attack: 1000, defense: 1000 },
      { code: "210", name: "Main2 Chain Handoff Turn Response Chain Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "220", name: "Main2 Chain Handoff Turn Response Chain Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "230", name: "Main2 Chain Handoff Turn Response Chain Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "240", name: "Main2 Chain Handoff Turn Response Chain Opponent Third Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "main2 open fast chain response pass handoff turn response chain fixture",
      options: { seed: 279, startingHandSize: 4 },
      decks: {
        0: { main: ["110", "130", "140", "150"] },
        1: { main: ["210", "230", "240", "220"] },
      },
      setup: {
        effects: [
          {
            id: "main2-chain-handoff-turn-response-chain-open-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 chain handoff turn response chain open quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-turn-response-chain-turn-chain-quick",
            player: 0,
            code: "130",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff turn response chain turn chain quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-turn-response-chain-opponent-first-chain-quick",
            player: 1,
            code: "210",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff turn response chain opponent first chain quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-turn-response-chain-opponent-second-chain-quick",
            player: 1,
            code: "230",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff turn response chain opponent second chain quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-turn-response-chain-opponent-third-chain-quick",
            player: 1,
            code: "240",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff turn response chain opponent third chain quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-turn-response-chain-opponent-open-quick",
            player: 1,
            code: "220",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 chain handoff turn response chain opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-chain-handoff-turn-response-chain-open-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "main2-chain-handoff-turn-response-chain-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "main2-chain-handoff-turn-response-chain-opponent-second-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-chain-handoff-turn-response-chain-turn-chain-quick" }), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps Main Phase 2 active and opens opponent chain responses after the turn player responds to an opponent chain from a chain-response pass handoff",
        phase: "main2",
        windowId: 7,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "main2-chain-handoff-turn-response-chain-open-quick", sourceUid: "p0-deck-110-0" },
          { player: 1, effectId: "main2-chain-handoff-turn-response-chain-opponent-first-chain-quick", sourceUid: "p1-deck-210-0" },
          { player: 1, effectId: "main2-chain-handoff-turn-response-chain-opponent-second-chain-quick", sourceUid: "p1-deck-230-1" },
          { player: 0, effectId: "main2-chain-handoff-turn-response-chain-turn-chain-quick", sourceUid: "p0-deck-130-1" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "main2-chain-handoff-turn-response-chain-opponent-third-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 7, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "main2-chain-handoff-turn-response-chain-opponent-third-chain-quick", 1, 7),
          chainPassGroup(1, 1, 7),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "main2-chain-handoff-turn-response-chain-open-quick" },
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "main2-chain-handoff-turn-response-chain-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "main2-chain-handoff-turn-response-chain-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "main2-chain-handoff-turn-response-chain-opponent-second-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "main2-chain-handoff-turn-response-chain-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "main2-chain-handoff-turn-response-chain-open-quick", 7, "chainResponse"),
          absentWindowEffectGroup(0, "main2-chain-handoff-turn-response-chain-turn-chain-quick", 7, "chainResponse"),
          absentWindowEffectGroup(1, "main2-chain-handoff-turn-response-chain-opponent-first-chain-quick", 7, "chainResponse"),
          absentWindowEffectGroup(1, "main2-chain-handoff-turn-response-chain-opponent-second-chain-quick", 7, "chainResponse"),
          absentWindowEffectGroup(1, "main2-chain-handoff-turn-response-chain-opponent-open-quick", 7, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
