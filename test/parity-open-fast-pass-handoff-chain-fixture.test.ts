import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentChainEffectGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  summonGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect pass handoff chain fixture", () => {
  it("opens opponent responses after the turn player chains from open fast-effect pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Handoff Chain Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Open Handoff Chain Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Open Handoff Chain Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Open Handoff Chain Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast pass handoff chain fixture",
      options: { seed: 301, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "200"] },
        1: { main: ["300", "400"] },
      },
      setup: {
        effects: [
          {
            id: "open-fast-handoff-chain-turn-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast handoff chain turn open quick should not resolve yet",
          },
          {
            id: "open-fast-handoff-chain-turn-chain-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast handoff chain turn chain quick should not resolve yet",
          },
          {
            id: "open-fast-handoff-chain-opponent-chain-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Open fast handoff chain opponent chain quick should not resolve yet",
          },
          {
            id: "open-fast-handoff-chain-opponent-open-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Open fast handoff chain opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-handoff-chain-turn-open-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps initial turn-player open priority restorable before starting an open fast-effect pass-handoff chain",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 7, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "open-fast-handoff-chain-turn-open-quick", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "200", location: "hand", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "200", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "200", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "open-fast-handoff-chain-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "open-fast-handoff-chain-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "open-fast-handoff-chain-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "open-fast-handoff-chain-turn-chain-quick", 0, "open"),
              absentWindowEffectGroup(1, "open-fast-handoff-chain-opponent-chain-quick", 0, "open"),
              absentWindowEffectGroup(1, "open-fast-handoff-chain-opponent-open-quick", 0, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent first response priority after an open fast-effect starts a chain",
            phase: "main1",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "open-fast-handoff-chain-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "open-fast-handoff-chain-opponent-chain-quick", 1, 1),
              chainPassGroup(1, 1, 1),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "open-fast-handoff-chain-opponent-open-quick", 1, "chainResponse")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored opponent response priority before the open fast-effect pass handoff",
            phase: "main1",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "open-fast-handoff-chain-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "open-fast-handoff-chain-opponent-chain-quick", 1, 1),
              chainPassGroup(1, 1, 1),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "open-fast-handoff-chain-opponent-open-quick", 1, "chainResponse")],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps restored open fast-effect pass handoff priority on the turn player before they chain",
            phase: "main1",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "open-fast-handoff-chain-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "open-fast-handoff-chain-turn-chain-quick", 1, 2),
              chainPassGroup(0, 1, 2),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-opponent-chain-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "open-fast-handoff-chain-turn-open-quick", 2, "chainResponse"),
              absentChainEffectGroup(1, "open-fast-handoff-chain-opponent-chain-quick", 2),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-handoff-chain-turn-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro allows the turn player to chain from the restored open fast-effect pass handoff window",
            phase: "main1",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "open-fast-handoff-chain-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "open-fast-handoff-chain-turn-chain-quick", 1, 2),
              chainPassGroup(0, 1, 2),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-opponent-chain-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "open-fast-handoff-chain-turn-open-quick", 2, "chainResponse"),
              absentChainEffectGroup(1, "open-fast-handoff-chain-opponent-chain-quick", 2),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro opens opponent response priority after the turn player chains from an open fast-effect pass handoff",
        phase: "main1",
        windowId: 3,
        windowKind: "chainResponse",
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [
          { player: 0, effectId: "open-fast-handoff-chain-turn-open-quick", sourceUid: "p0-deck-100-0" },
          { player: 0, effectId: "open-fast-handoff-chain-turn-chain-quick", sourceUid: "p0-deck-200-1" },
        ],
        chainPasses: [],
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-opponent-chain-quick", count: 1 },
          { type: "passChain", player: 1, windowId: 3, windowKind: "chainResponse", count: 1 },
        ],
        legalActionGroups: [
          chainEffectGroup(1, "open-fast-handoff-chain-opponent-chain-quick", 1, 3),
          chainPassGroup(1, 1, 3),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-fast-handoff-chain-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "open-fast-handoff-chain-turn-open-quick", 3, "chainResponse"),
          absentChainEffectGroup(0, "open-fast-handoff-chain-turn-chain-quick", 3),
          absentWindowEffectGroup(1, "open-fast-handoff-chain-opponent-open-quick", 3, "chainResponse"),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
