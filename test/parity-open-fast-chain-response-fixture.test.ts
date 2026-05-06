import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect chain response fixture", () => {
  it("returns open fast-effect chain response priority to the turn player after the opponent chains", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Turn Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Opponent Open Quick", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast chain response fixture",
      options: { seed: 267, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "200"] },
        1: { main: ["300", "400"] },
      },
      setup: {
        effects: [
          {
            id: "open-fast-chain-turn-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Turn open fast chain response quick resolved",
          },
          {
            id: "open-fast-chain-turn-chain-quick",
            player: 0,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Turn chain-only fast chain response quick resolved",
          },
          {
            id: "open-fast-chain-opponent-chain-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Opponent chain fast response quick resolved",
          },
          {
            id: "open-fast-chain-opponent-open-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Opponent open fast chain response quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-chain-turn-open-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent first chain-response priority after the turn player starts an open fast-effect chain",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            pendingTriggers: [],
            chain: [{ player: 0, effectId: "open-fast-chain-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-chain-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "open-fast-chain-opponent-chain-quick", 1, 1), chainPassGroup(1, 1, 1)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-chain-opponent-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(1, "open-fast-chain-opponent-open-quick", 1, "chainResponse")],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "open-fast-chain-opponent-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the turn player chain-response priority after the opponent chains to an open fast effect",
            windowId: 2,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            chain: [
              { player: 0, effectId: "open-fast-chain-turn-open-quick", sourceUid: "p0-deck-100-0" },
              { player: 1, effectId: "open-fast-chain-opponent-chain-quick", sourceUid: "p1-deck-300-0" },
            ],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-chain-turn-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "open-fast-chain-turn-chain-quick", 1, 2), chainPassGroup(0, 1, 2)],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "open-fast-chain-turn-open-quick" }],
            absentLegalActionGroups: [absentWindowEffectGroup(0, "open-fast-chain-turn-open-quick", 2, "chainResponse")],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-chain-turn-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the chained open fast effects and returns to turn-player open priority",
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
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "open-fast-chain-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "open-fast-chain-turn-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "open-fast-chain-opponent-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "open-fast-chain-turn-open-quick", 3, "open"),
              absentWindowEffectGroup(0, "open-fast-chain-turn-chain-quick", 3, "open"),
              absentWindowEffectGroup(1, "open-fast-chain-opponent-open-quick", 3, "open"),
            ],
            logIncludes: [
              "Turn chain-only fast chain response quick resolved",
              "Opponent chain fast response quick resolved",
              "Turn open fast chain response quick resolved",
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state keeps turn-player open priority after chained open fast effects resolve",
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
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "open-fast-chain-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "open-fast-chain-turn-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "open-fast-chain-opponent-open-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "open-fast-chain-turn-open-quick", 3, "open"),
          absentWindowEffectGroup(0, "open-fast-chain-turn-chain-quick", 3, "open"),
          absentWindowEffectGroup(1, "open-fast-chain-opponent-open-quick", 3, "open"),
        ],
        logIncludes: [
          "Turn chain-only fast chain response quick resolved",
          "Opponent chain fast response quick resolved",
          "Turn open fast chain response quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
