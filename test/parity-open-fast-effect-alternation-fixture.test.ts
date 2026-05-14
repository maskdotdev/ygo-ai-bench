import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, chainEffectGroup, chainPassGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect alternation fixtures", () => {
  it("returns chain response priority to the turn player after the opponent chains", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Turn Normal Follow-up", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast effect alternation fixture",
      options: { seed: 261, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "400"] },
        1: { main: ["200", "400", "400"] },
      },
      setup: {
        effects: [
          {
            id: "alternation-turn-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn open quick resolved",
          },
          {
            id: "alternation-turn-chain-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Turn chain quick resolved",
          },
          {
            id: "alternation-opponent-chain-quick",
            player: 1,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent chain quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "alternation-turn-open-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes open fast effects without exposing chain-only quick effects before a chain starts",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 9, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "alternation-turn-open-quick", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "alternation-turn-open-quick", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "alternation-turn-chain-quick" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 0,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "alternation-turn-chain-quick" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro gives the non-turn player first response priority after an open fast effect starts a chain",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "alternation-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "alternation-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "alternation-opponent-chain-quick", 1, 1), chainPassGroup(1, 1, 1)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "alternation-opponent-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored opponent response priority after an open fast effect starts a chain",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "alternation-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "alternation-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "alternation-opponent-chain-quick", 1, 1), chainPassGroup(1, 1, 1)],
          },
          after: {
            source: "edopro",
            note: "EDOPro alternates chain response priority back to the turn player after the opponent adds a fast effect",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 0,
            chain: [
              { player: 0, effectId: "alternation-turn-open-quick", sourceUid: "p0-deck-100-0" },
              { player: 1, effectId: "alternation-opponent-chain-quick", sourceUid: "p1-deck-200-0" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "alternation-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "alternation-turn-chain-quick", 1, 2), chainPassGroup(0, 1, 2)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "alternation-opponent-chain-quick" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "alternation-opponent-chain-quick", 2)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "alternation-turn-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored turn-player response priority after the opponent chains to an open fast effect",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 0,
            chain: [
              { player: 0, effectId: "alternation-turn-open-quick", sourceUid: "p0-deck-100-0" },
              { player: 1, effectId: "alternation-opponent-chain-quick", sourceUid: "p1-deck-200-0" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "alternation-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "alternation-turn-chain-quick", 1, 2), chainPassGroup(0, 1, 2)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "alternation-opponent-chain-quick" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "alternation-opponent-chain-quick", 2)],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the fast-effect chain when no legal opponent response remains",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            legalActionCounts: { 0: 8, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
              ], 1, 3),
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "alternation-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "alternation-turn-chain-quick" },
            ],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 3,
                windowKind: "open",
                actions: [
                  { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "alternation-turn-open-quick" },
                  { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "alternation-turn-chain-quick" },
                ],
              },
            ],
            logIncludes: ["Turn chain quick resolved", "Opponent chain quick resolved", "Turn open quick resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro returns to turn-player open priority after the alternated fast-effect chain resolves",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        legalActionCounts: { 0: 8, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "300", location: "hand" },
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "300", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
          ], 1, 3),
          turnGroup(3),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "alternation-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "alternation-turn-chain-quick" },
        ],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 3,
            windowKind: "open",
            actions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "alternation-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "alternation-turn-chain-quick" },
            ],
          },
        ],
        logIncludes: ["Turn chain quick resolved", "Opponent chain quick resolved", "Turn open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
