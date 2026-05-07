import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Main Phase 2 open fast-effect pass handoff chain fixture", () => {
  it("reopens opponent responses after the turn player chains from a Main Phase 2 pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Main2 Handoff Chain Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "130", name: "Main2 Handoff Chain Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "210", name: "Main2 Handoff Chain Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "220", name: "Main2 Handoff Chain Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "main2 open fast pass handoff chain fixture",
      options: { seed: 273, startingHandSize: 2 },
      decks: {
        0: { main: ["110", "130"] },
        1: { main: ["210", "220"] },
      },
      setup: {
        effects: [
          {
            id: "main2-handoff-chain-turn-open-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 handoff chain turn open quick should not resolve yet",
          },
          {
            id: "main2-handoff-chain-turn-chain-quick",
            player: 0,
            code: "130",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff chain turn chain quick should not resolve yet",
          },
          {
            id: "main2-handoff-chain-opponent-chain-quick",
            player: 1,
            code: "210",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff chain opponent chain quick should not resolve yet",
          },
          {
            id: "main2-handoff-chain-opponent-open-quick",
            player: 1,
            code: "220",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 handoff chain opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-handoff-chain-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-handoff-chain-turn-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored Main Phase 2 open fast-effect pass handoff priority on the turn player before they chain",
            phase: "main2",
            windowId: 4,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "main2-handoff-chain-turn-open-quick", sourceUid: "p0-deck-110-0" }],
            chainPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "main2-handoff-chain-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "main2-handoff-chain-turn-chain-quick", 1, 4),
              chainPassGroup(0, 1, 4),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "main2-handoff-chain-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "main2-handoff-chain-opponent-chain-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "main2-handoff-chain-turn-open-quick", 4, "chainResponse"),
              absentChainEffectGroup(1, "main2-handoff-chain-opponent-chain-quick", 4),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro reopens restored opponent response priority after the turn player chains from a Main Phase 2 open fast-effect pass handoff",
            phase: "main2",
            windowId: 5,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "main2-handoff-chain-turn-open-quick", sourceUid: "p0-deck-110-0" },
              { player: 0, effectId: "main2-handoff-chain-turn-chain-quick", sourceUid: "p0-deck-130-1" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "main2-handoff-chain-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "main2-handoff-chain-opponent-chain-quick", 1, 5),
              chainPassGroup(1, 1, 5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "main2-handoff-chain-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "main2-handoff-chain-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "main2-handoff-chain-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "main2-handoff-chain-turn-open-quick", 5, "chainResponse"),
              absentChainEffectGroup(0, "main2-handoff-chain-turn-chain-quick", 5),
              absentWindowEffectGroup(1, "main2-handoff-chain-opponent-open-quick", 5, "chainResponse"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps Main Phase 2 active and reopens opponent response priority after the turn player chains from an open fast-effect pass handoff",
        phase: "main2",
        windowId: 5,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "main2-handoff-chain-turn-open-quick", sourceUid: "p0-deck-110-0" },
          { player: 0, effectId: "main2-handoff-chain-turn-chain-quick", sourceUid: "p0-deck-130-1" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "main2-handoff-chain-opponent-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 5, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "main2-handoff-chain-opponent-chain-quick", 1, 5),
          chainPassGroup(1, 1, 5),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "main2-handoff-chain-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "main2-handoff-chain-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "main2-handoff-chain-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "main2-handoff-chain-turn-open-quick", 5, "chainResponse"),
          absentWindowEffectGroup(0, "main2-handoff-chain-turn-chain-quick", 5, "chainResponse"),
          absentWindowEffectGroup(1, "main2-handoff-chain-opponent-open-quick", 5, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
