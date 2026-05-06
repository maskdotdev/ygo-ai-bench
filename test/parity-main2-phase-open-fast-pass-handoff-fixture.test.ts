import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Main Phase 2 open fast-effect pass handoff fixture", () => {
  it("preserves Main Phase 2 while handing chain-response priority back after an opponent pass", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Turn Main2 Pass Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "130", name: "Turn Main2 Pass Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "210", name: "Opponent Main2 Pass Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "220", name: "Opponent Main2 Pass Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "main2 phase open fast pass handoff fixture",
      options: { seed: 272, startingHandSize: 2 },
      decks: {
        0: { main: ["110", "130"] },
        1: { main: ["210", "220"] },
      },
      setup: {
        effects: [
          {
            id: "phase-main2-pass-turn-open-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn Main2 pass handoff open quick resolved",
          },
          {
            id: "phase-main2-pass-turn-chain-quick",
            player: 0,
            code: "130",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Turn Main2 pass handoff chain quick should not resolve",
          },
          {
            id: "phase-main2-pass-opponent-chain-quick",
            player: 1,
            code: "210",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Opponent Main2 pass handoff chain quick should not resolve",
          },
          {
            id: "phase-main2-pass-opponent-open-quick",
            player: 1,
            code: "220",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Opponent Main2 pass handoff open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro keeps Battle Phase entry on turn-player open priority before the Main Phase 2 handoff path",
            windowId: 1,
            windowKind: "open",
            phase: "battle",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(1)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "phase-main2-pass-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "phase-main2-pass-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "phase-main2-pass-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "phase-main2-pass-turn-open-quick", 1, "open"),
              absentWindowEffectGroup(0, "phase-main2-pass-turn-chain-quick", 1, "open"),
              absentWindowEffectGroup(1, "phase-main2-pass-opponent-open-quick", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro exposes only turn-player open fast effects after entering Main Phase 2",
            windowId: 2,
            windowKind: "open",
            phase: "main2",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            legalActionCounts: { 0: 7, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "phase-main2-pass-turn-open-quick", count: 1 },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "110", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "130", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "110", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "130", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 2,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "phase-main2-pass-turn-open-quick", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "110", location: "hand" },
                { type: "normalSummon", player: 0, code: "130", location: "hand" },
                { type: "setMonster", player: 0, code: "110", location: "hand" },
                { type: "setMonster", player: 0, code: "130", location: "hand" },
              ], 1, 2),
              turnGroup(2),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "phase-main2-pass-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "open", effectId: "phase-main2-pass-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "phase-main2-pass-turn-chain-quick", 2, "open"),
              absentWindowEffectGroup(1, "phase-main2-pass-opponent-open-quick", 2, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "phase-main2-pass-turn-open-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent first chain-response priority after a Main Phase 2 open fast effect",
            windowId: 3,
            windowKind: "chainResponse",
            phase: "main2",
            waitingFor: 1,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "phase-main2-pass-turn-open-quick", sourceUid: "p0-deck-110-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "phase-main2-pass-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "phase-main2-pass-opponent-chain-quick", 1, 3), chainPassGroup(1, 1, 3)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "phase-main2-pass-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "phase-main2-pass-opponent-open-quick", 3, "chainResponse")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro preserves Main Phase 2 while returning chain-response priority to the turn player after an opponent pass",
            windowId: 4,
            windowKind: "chainResponse",
            phase: "main2",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "phase-main2-pass-turn-open-quick", sourceUid: "p0-deck-110-0" }],
            chainPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "phase-main2-pass-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "phase-main2-pass-turn-chain-quick", 1, 4), chainPassGroup(0, 1, 4)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "phase-main2-pass-turn-open-quick" },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "phase-main2-pass-opponent-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "phase-main2-pass-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "phase-main2-pass-turn-open-quick", 4, "chainResponse"),
              absentWindowEffectGroup(1, "phase-main2-pass-opponent-chain-quick", 4, "chainResponse"),
              absentWindowEffectGroup(1, "phase-main2-pass-opponent-open-quick", 4, "chainResponse"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the Main Phase 2 open fast-effect chain after both players pass and returns to turn-player open priority",
            windowId: 5,
            windowKind: "open",
            phase: "main2",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "110", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "130", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 5, windowKind: "open", code: "110", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 5, windowKind: "open", code: "130", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "110", location: "hand" },
                { type: "normalSummon", player: 0, code: "130", location: "hand" },
                { type: "setMonster", player: 0, code: "110", location: "hand" },
                { type: "setMonster", player: 0, code: "130", location: "hand" },
              ], 1, 5),
              turnGroup(5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "phase-main2-pass-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "phase-main2-pass-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "phase-main2-pass-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "phase-main2-pass-turn-open-quick", 5, "open"),
              absentWindowEffectGroup(0, "phase-main2-pass-turn-chain-quick", 5, "open"),
              absentWindowEffectGroup(1, "phase-main2-pass-opponent-open-quick", 5, "open"),
            ],
            logIncludes: ["Turn Main2 pass handoff open quick resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns a resolved Main Phase 2 pass-handoff fast-effect chain to turn-player open priority",
        windowId: 5,
        windowKind: "open",
        phase: "main2",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 6, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 5, windowKind: "open", code: "130", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 5, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 5, windowKind: "open", code: "130", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 5, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 5, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "110", location: "hand" },
            { type: "normalSummon", player: 0, code: "130", location: "hand" },
            { type: "setMonster", player: 0, code: "110", location: "hand" },
            { type: "setMonster", player: 0, code: "130", location: "hand" },
          ], 1, 5),
          turnGroup(5),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "phase-main2-pass-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "phase-main2-pass-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "phase-main2-pass-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "phase-main2-pass-turn-open-quick", 5, "open"),
          absentWindowEffectGroup(0, "phase-main2-pass-turn-chain-quick", 5, "open"),
          absentWindowEffectGroup(1, "phase-main2-pass-opponent-open-quick", 5, "open"),
        ],
        logIncludes: ["Turn Main2 pass handoff open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
