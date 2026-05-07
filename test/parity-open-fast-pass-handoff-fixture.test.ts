import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect pass handoff fixture", () => {
  it("returns open fast-effect chain response priority to the turn player after the opponent passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast pass handoff fixture",
      options: { seed: 266, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "200"] },
        1: { main: ["300", "400"] },
      },
      setup: {
        effects: [
          {
            id: "open-fast-pass-turn-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn open fast pass handoff quick resolved",
          },
          {
            id: "open-fast-pass-turn-chain-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Turn chain-only fast pass handoff quick should not resolve",
          },
          {
            id: "open-fast-pass-opponent-chain-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Opponent chain fast pass handoff quick should not resolve",
          },
          {
            id: "open-fast-pass-opponent-open-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Opponent open fast pass handoff quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-pass-turn-open-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent first chain-response priority after the turn player starts an open fast-effect chain",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "open-fast-pass-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-pass-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "open-fast-pass-opponent-chain-quick", 1, 1), chainPassGroup(1, 1, 1)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-pass-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "open-fast-pass-opponent-open-quick", 1, "chainResponse")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored opponent chain-response priority before the first open fast-effect pass",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "open-fast-pass-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-pass-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "open-fast-pass-opponent-chain-quick", 1, 1), chainPassGroup(1, 1, 1)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-pass-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "open-fast-pass-opponent-open-quick", 1, "chainResponse")],
          },
          after: {
            source: "edopro",
            note: "EDOPro returns open fast-effect chain-response priority to the turn player after the opponent passes with a response available",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "open-fast-pass-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-pass-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "open-fast-pass-turn-chain-quick", 1, 2), chainPassGroup(0, 1, 2)],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-pass-turn-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(0, "open-fast-pass-turn-open-quick", 2, "chainResponse")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored turn-player chain-response priority before the returned pass",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "open-fast-pass-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-pass-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "open-fast-pass-turn-chain-quick", 1, 2), chainPassGroup(0, 1, 2)],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-pass-turn-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(0, "open-fast-pass-turn-open-quick", 2, "chainResponse")],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the open fast-effect chain after both players pass and returns to turn-player open priority",
            windowId: 3,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "200", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "200", location: "hand" },
              ], 1, 3),
              turnGroup(3),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "open-fast-pass-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "open-fast-pass-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "open-fast-pass-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "open-fast-pass-turn-open-quick", 3, "open"),
              absentWindowEffectGroup(0, "open-fast-pass-turn-chain-quick", 3, "open"),
              absentWindowEffectGroup(1, "open-fast-pass-opponent-open-quick", 3, "open"),
            ],
            logIncludes: ["Turn open fast pass handoff quick resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps turn-player open priority after an open fast-effect chain resolves from pass handoff",
        windowId: 3,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 6, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 3, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 3, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "200", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "200", location: "hand" },
          ], 1, 3),
          turnGroup(3),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "open-fast-pass-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "open-fast-pass-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "open-fast-pass-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "open-fast-pass-turn-open-quick", 3, "open"),
          absentWindowEffectGroup(0, "open-fast-pass-turn-chain-quick", 3, "open"),
          absentWindowEffectGroup(1, "open-fast-pass-opponent-open-quick", 3, "open"),
        ],
        logIncludes: ["Turn open fast pass handoff quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
