import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Main Phase 2 open fast-effect pass handoff fixture", () => {
  it("returns Main Phase 2 open fast-effect chain-response priority to the turn player after the opponent passes", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Main2 Handoff Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "130", name: "Main2 Handoff Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "210", name: "Main2 Handoff Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "220", name: "Main2 Handoff Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "main2 open fast pass handoff fixture",
      options: { seed: 371, startingHandSize: 2 },
      decks: {
        0: { main: ["110", "130"] },
        1: { main: ["210", "220"] },
      },
      setup: {
        effects: [
          {
            id: "main2-handoff-turn-open-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 handoff turn open quick resolved",
          },
          {
            id: "main2-handoff-turn-chain-quick",
            player: 0,
            code: "130",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff turn chain quick should not resolve",
          },
          {
            id: "main2-handoff-opponent-chain-quick",
            player: 1,
            code: "210",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Main2 handoff opponent chain quick should not resolve",
          },
          {
            id: "main2-handoff-opponent-open-quick",
            player: 1,
            code: "220",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Main2 handoff opponent open quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "main2-handoff-turn-open-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent first chain-response priority after the turn player starts a Main Phase 2 open fast-effect chain",
            phase: "main2",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "main2-handoff-turn-open-quick", sourceUid: "p0-deck-110-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "main2-handoff-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "main2-handoff-opponent-chain-quick", 1, 3),
              chainPassGroup(1, 1, 3),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "main2-handoff-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "main2-handoff-opponent-open-quick", 3, "chainResponse")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro returns Main Phase 2 open fast-effect chain-response priority to the turn player after the opponent passes with a response available",
            phase: "main2",
            windowId: 4,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 0, effectId: "main2-handoff-turn-open-quick", sourceUid: "p0-deck-110-0" }],
            chainPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "main2-handoff-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "main2-handoff-turn-chain-quick", 1, 4),
              chainPassGroup(0, 1, 4),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 4, windowKind: "chainResponse", effectId: "main2-handoff-turn-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(0, "main2-handoff-turn-open-quick", 4, "chainResponse")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the restored Main Phase 2 open fast-effect chain after both players pass and returns to turn-player Main Phase 2 open priority",
            phase: "main2",
            windowId: 5,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
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
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "main2-handoff-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "main2-handoff-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "main2-handoff-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "main2-handoff-turn-open-quick", 5, "open"),
              absentWindowEffectGroup(0, "main2-handoff-turn-chain-quick", 5, "open"),
              absentWindowEffectGroup(1, "main2-handoff-opponent-open-quick", 5, "open"),
            ],
            logIncludes: ["Main2 handoff turn open quick resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves the Main Phase 2 open fast-effect chain after both players pass and returns to turn-player Main Phase 2 open priority",
        phase: "main2",
        windowId: 5,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
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
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "main2-handoff-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 5, windowKind: "open", effectId: "main2-handoff-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 5, windowKind: "open", effectId: "main2-handoff-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "main2-handoff-turn-open-quick", 5, "open"),
          absentWindowEffectGroup(0, "main2-handoff-turn-chain-quick", 5, "open"),
          absentWindowEffectGroup(1, "main2-handoff-opponent-open-quick", 5, "open"),
        ],
        logIncludes: ["Main2 handoff turn open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
