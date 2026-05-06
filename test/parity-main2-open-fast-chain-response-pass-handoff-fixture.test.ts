import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Main Phase 2 open fast-effect chain-response pass handoff fixture", () => {
  it("returns response priority to the opponent after the turn player passes an opponent Main Phase 2 chain link", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Main2 Chain Handoff Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "130", name: "Main2 Chain Handoff Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "140", name: "Main2 Chain Handoff Turn Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "210", name: "Main2 Chain Handoff Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "220", name: "Main2 Chain Handoff Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "230", name: "Main2 Chain Handoff Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "main2 open fast chain response pass handoff fixture",
      options: { seed: 275, startingHandSize: 3 },
      decks: {
        0: { main: ["110", "130", "140"] },
        1: { main: ["210", "230", "220"] },
      },
      setup: {
        effects: [
          {
            id: "main2-chain-handoff-turn-open-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 chain handoff turn open quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-turn-chain-quick",
            player: 0,
            code: "130",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff turn chain quick should not resolve",
          },
          {
            id: "main2-chain-handoff-opponent-first-chain-quick",
            player: 1,
            code: "210",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff opponent first chain quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-opponent-second-chain-quick",
            player: 1,
            code: "230",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 chain handoff opponent second chain quick should not resolve yet",
          },
          {
            id: "main2-chain-handoff-opponent-open-quick",
            player: 1,
            code: "220",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 chain handoff opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-chain-handoff-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "main2-chain-handoff-opponent-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps Main Phase 2 active and returns response priority to the opponent after the turn player passes an opponent chain link",
        phase: "main2",
        windowId: 5,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "main2-chain-handoff-turn-open-quick", sourceUid: "p0-deck-110-0" },
          { player: 1, effectId: "main2-chain-handoff-opponent-first-chain-quick", sourceUid: "p1-deck-210-0" },
        ],
        chainPasses: [0],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "main2-chain-handoff-opponent-second-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 5, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "main2-chain-handoff-opponent-second-chain-quick", 1, 5),
          chainPassGroup(1, 1, 5),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "main2-chain-handoff-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "main2-chain-handoff-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "main2-chain-handoff-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "main2-chain-handoff-turn-chain-quick", 5, "chainResponse"),
          absentWindowEffectGroup(1, "main2-chain-handoff-opponent-first-chain-quick", 5, "chainResponse"),
          absentWindowEffectGroup(1, "main2-chain-handoff-opponent-open-quick", 5, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
