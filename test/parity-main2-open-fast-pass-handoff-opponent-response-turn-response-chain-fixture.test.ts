import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Main Phase 2 open fast-effect pass handoff opponent response turn response chain fixture", () => {
  it("opens opponent responses after the turn player answers a Main Phase 2 pass-handoff response", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Main2 Handoff Opponent Turn Response Chain Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "130", name: "Main2 Handoff Opponent Turn Response Chain First Turn Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "140", name: "Main2 Handoff Opponent Turn Response Chain Second Turn Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "210", name: "Main2 Handoff Opponent Turn Response Chain First Opponent Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "220", name: "Main2 Handoff Opponent Turn Response Chain Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "230", name: "Main2 Handoff Opponent Turn Response Chain Second Opponent Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "main2 open fast pass handoff opponent response turn response chain fixture",
      options: { seed: 292, startingHandSize: 3 },
      decks: {
        0: { main: ["110", "130", "140"] },
        1: { main: ["210", "230", "220"] },
      },
      setup: {
        effects: [
          {
            id: "main2-handoff-opponent-turn-response-chain-open-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 handoff opponent turn response chain open quick should not resolve yet",
          },
          {
            id: "main2-handoff-opponent-turn-response-chain-first-turn-quick",
            player: 0,
            code: "130",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff opponent turn response chain first turn quick should not resolve yet",
          },
          {
            id: "main2-handoff-opponent-turn-response-chain-second-turn-quick",
            player: 0,
            code: "140",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff opponent turn response chain second turn quick should not resolve yet",
          },
          {
            id: "main2-handoff-opponent-turn-response-chain-first-opponent-quick",
            player: 1,
            code: "210",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff opponent turn response chain first opponent quick should not resolve yet",
          },
          {
            id: "main2-handoff-opponent-turn-response-chain-second-opponent-quick",
            player: 1,
            code: "230",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff opponent turn response chain second opponent quick should not resolve yet",
          },
          {
            id: "main2-handoff-opponent-turn-response-chain-opponent-open-quick",
            player: 1,
            code: "220",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 handoff opponent turn response chain opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-handoff-opponent-turn-response-chain-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-handoff-opponent-turn-response-chain-first-turn-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "main2-handoff-opponent-turn-response-chain-first-opponent-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-handoff-opponent-turn-response-chain-second-turn-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored Main Phase 2 turn-player priority before their second pass-handoff response",
            phase: "main2",
            windowId: 6,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "main2-handoff-opponent-turn-response-chain-open-quick", sourceUid: "p0-deck-110-0" },
              { player: 0, effectId: "main2-handoff-opponent-turn-response-chain-first-turn-quick", sourceUid: "p0-deck-130-1" },
              { player: 1, effectId: "main2-handoff-opponent-turn-response-chain-first-opponent-quick", sourceUid: "p1-deck-210-0" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "main2-handoff-opponent-turn-response-chain-second-turn-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "main2-handoff-opponent-turn-response-chain-second-turn-quick", 1, 6),
              chainPassGroup(0, 1, 6),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "main2-handoff-opponent-turn-response-chain-open-quick" },
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "main2-handoff-opponent-turn-response-chain-first-turn-quick" },
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "main2-handoff-opponent-turn-response-chain-first-opponent-quick" },
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "main2-handoff-opponent-turn-response-chain-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "main2-handoff-opponent-turn-response-chain-open-quick", 6, "chainResponse"),
              absentChainEffectGroup(0, "main2-handoff-opponent-turn-response-chain-first-turn-quick", 6),
              absentChainEffectGroup(1, "main2-handoff-opponent-turn-response-chain-first-opponent-quick", 6),
              absentWindowEffectGroup(1, "main2-handoff-opponent-turn-response-chain-opponent-open-quick", 6, "chainResponse"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps Main Phase 2 active and opens opponent chain responses after the turn player answers a pass-handoff response",
        phase: "main2",
        windowId: 7,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "main2-handoff-opponent-turn-response-chain-open-quick", sourceUid: "p0-deck-110-0" },
          { player: 0, effectId: "main2-handoff-opponent-turn-response-chain-first-turn-quick", sourceUid: "p0-deck-130-1" },
          { player: 1, effectId: "main2-handoff-opponent-turn-response-chain-first-opponent-quick", sourceUid: "p1-deck-210-0" },
          { player: 0, effectId: "main2-handoff-opponent-turn-response-chain-second-turn-quick", sourceUid: "p0-deck-140-2" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "main2-handoff-opponent-turn-response-chain-second-opponent-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 7, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "main2-handoff-opponent-turn-response-chain-second-opponent-quick", 1, 7),
          chainPassGroup(1, 1, 7),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "main2-handoff-opponent-turn-response-chain-open-quick" },
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "main2-handoff-opponent-turn-response-chain-first-turn-quick" },
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "main2-handoff-opponent-turn-response-chain-second-turn-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "main2-handoff-opponent-turn-response-chain-first-opponent-quick" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "chainResponse", effectId: "main2-handoff-opponent-turn-response-chain-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "main2-handoff-opponent-turn-response-chain-open-quick", 7, "chainResponse"),
          absentChainEffectGroup(0, "main2-handoff-opponent-turn-response-chain-first-turn-quick", 7),
          absentChainEffectGroup(0, "main2-handoff-opponent-turn-response-chain-second-turn-quick", 7),
          absentChainEffectGroup(1, "main2-handoff-opponent-turn-response-chain-first-opponent-quick", 7),
          absentWindowEffectGroup(1, "main2-handoff-opponent-turn-response-chain-opponent-open-quick", 7, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
