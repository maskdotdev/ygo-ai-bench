import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect chain-response pass handoff chain fixture", () => {
  it("returns response priority to the turn player after the opponent chains from chain-response pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Chain Handoff Chain Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Open Chain Handoff Chain Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Open Chain Handoff Chain Opponent First Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "500", name: "Open Chain Handoff Chain Opponent Second Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "600", name: "Open Chain Handoff Chain Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast chain response pass handoff chain fixture",
      options: { seed: 305, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "200", "100"] },
        1: { main: ["300", "500", "600"] },
      },
      setup: {
        effects: [
          {
            id: "open-fast-chain-handoff-chain-turn-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast chain handoff chain turn open quick should not resolve yet",
          },
          {
            id: "open-fast-chain-handoff-chain-turn-chain-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast chain handoff chain turn chain quick should not resolve yet",
          },
          {
            id: "open-fast-chain-handoff-chain-opponent-first-chain-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast chain handoff chain opponent first chain quick should not resolve yet",
          },
          {
            id: "open-fast-chain-handoff-chain-opponent-second-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast chain handoff chain opponent second chain quick should not resolve yet",
          },
          {
            id: "open-fast-chain-handoff-chain-opponent-open-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast chain handoff chain opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-chain-handoff-chain-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "open-fast-chain-handoff-chain-opponent-first-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored opponent response priority before the first chain link in the chain-response handoff",
            phase: "main1",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "open-fast-chain-handoff-chain-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 3 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-first-chain-quick", count: 1 },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-second-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "open-fast-chain-handoff-chain-opponent-first-chain-quick", 1, 1),
              chainPassGroup(1, 1, 1),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "open-fast-chain-handoff-chain-turn-chain-quick", 1),
              absentWindowEffectGroup(1, "open-fast-chain-handoff-chain-opponent-open-quick", 1, "chainResponse"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns response priority to the turn player after the opponent chains to an open fast effect",
            phase: "main1",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "open-fast-chain-handoff-chain-turn-open-quick", sourceUid: "p0-deck-100-0" },
              { player: 1, effectId: "open-fast-chain-handoff-chain-opponent-first-chain-quick", sourceUid: "p1-deck-300-0" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "open-fast-chain-handoff-chain-turn-chain-quick", 1, 2),
              chainPassGroup(0, 1, 2),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-first-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-second-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "open-fast-chain-handoff-chain-turn-open-quick", 2, "chainResponse"),
              absentChainEffectGroup(1, "open-fast-chain-handoff-chain-opponent-first-chain-quick", 2),
              absentChainEffectGroup(1, "open-fast-chain-handoff-chain-opponent-second-chain-quick", 2),
              absentWindowEffectGroup(1, "open-fast-chain-handoff-chain-opponent-open-quick", 2, "chainResponse"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored turn-player response priority before passing the opponent chain link",
            phase: "main1",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "open-fast-chain-handoff-chain-turn-open-quick", sourceUid: "p0-deck-100-0" },
              { player: 1, effectId: "open-fast-chain-handoff-chain-opponent-first-chain-quick", sourceUid: "p1-deck-300-0" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "open-fast-chain-handoff-chain-turn-chain-quick", 1, 2),
              chainPassGroup(0, 1, 2),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-first-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-second-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "open-fast-chain-handoff-chain-turn-open-quick", 2, "chainResponse"),
              absentChainEffectGroup(1, "open-fast-chain-handoff-chain-opponent-first-chain-quick", 2),
              absentChainEffectGroup(1, "open-fast-chain-handoff-chain-opponent-second-chain-quick", 2),
              absentWindowEffectGroup(1, "open-fast-chain-handoff-chain-opponent-open-quick", 2, "chainResponse"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps restored chain-response pass handoff priority on the opponent before they chain again",
            phase: "main1",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "open-fast-chain-handoff-chain-turn-open-quick", sourceUid: "p0-deck-100-0" },
              { player: 1, effectId: "open-fast-chain-handoff-chain-opponent-first-chain-quick", sourceUid: "p1-deck-300-0" },
            ],
            chainPasses: [0],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-second-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "open-fast-chain-handoff-chain-opponent-second-chain-quick", 1, 3),
              chainPassGroup(1, 1, 3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-first-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "open-fast-chain-handoff-chain-turn-chain-quick", 3),
              absentChainEffectGroup(1, "open-fast-chain-handoff-chain-opponent-first-chain-quick", 3),
              absentWindowEffectGroup(1, "open-fast-chain-handoff-chain-opponent-open-quick", 3, "chainResponse"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "open-fast-chain-handoff-chain-opponent-second-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro allows the opponent to chain from the restored chain-response pass handoff window",
            phase: "main1",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "open-fast-chain-handoff-chain-turn-open-quick", sourceUid: "p0-deck-100-0" },
              { player: 1, effectId: "open-fast-chain-handoff-chain-opponent-first-chain-quick", sourceUid: "p1-deck-300-0" },
            ],
            chainPasses: [0],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-second-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "open-fast-chain-handoff-chain-opponent-second-chain-quick", 1, 3),
              chainPassGroup(1, 1, 3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-first-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentChainEffectGroup(0, "open-fast-chain-handoff-chain-turn-chain-quick", 3),
              absentChainEffectGroup(1, "open-fast-chain-handoff-chain-opponent-first-chain-quick", 3),
              absentWindowEffectGroup(1, "open-fast-chain-handoff-chain-opponent-open-quick", 3, "chainResponse"),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro returns response priority to the turn player after the opponent chains from a chain-response pass handoff",
        phase: "main1",
        windowId: 4,
        windowKind: "chainResponse",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "open-fast-chain-handoff-chain-turn-open-quick", sourceUid: "p0-deck-100-0" },
          { player: 1, effectId: "open-fast-chain-handoff-chain-opponent-first-chain-quick", sourceUid: "p1-deck-300-0" },
          { player: 1, effectId: "open-fast-chain-handoff-chain-opponent-second-chain-quick", sourceUid: "p1-deck-500-1" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-turn-chain-quick", count: 1 },
          { type: "passChain", player: 0, windowId: 4, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(0, "open-fast-chain-handoff-chain-turn-chain-quick", 1, 4),
          chainPassGroup(0, 1, 4),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-turn-open-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-second-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "open-fast-chain-handoff-chain-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "open-fast-chain-handoff-chain-turn-open-quick", 4, "chainResponse"),
          absentChainEffectGroup(1, "open-fast-chain-handoff-chain-opponent-first-chain-quick", 4),
          absentChainEffectGroup(1, "open-fast-chain-handoff-chain-opponent-second-chain-quick", 4),
          absentWindowEffectGroup(1, "open-fast-chain-handoff-chain-opponent-open-quick", 4, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
