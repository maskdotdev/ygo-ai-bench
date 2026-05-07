import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { chainEffectGroup, chainPassGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect priority fixtures", () => {
  it("passes priority to the opponent after an open quick effect starts a chain", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Opponent Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Normal Follow-up", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast effect priority fixture",
      options: { seed: 260, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["200", "300"] },
      },
      setup: {
        effects: [
          {
            id: "fixture-turn-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            logMessage: "Turn open quick resolved",
          },
          {
            id: "fixture-opponent-chain-quick",
            player: 1,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            logMessage: "Opponent chain quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-open-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes open fast effects beside normal Main Phase actions before a chain starts",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            phase: "main1",
            legalActionCounts: { 0: 7, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-turn-open-quick", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
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
                actions: [{ type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "fixture-turn-open-quick", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
              ], 1, 0),
              turnGroup(0),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro gives the non-turn player the first chain response after an open fast effect is activated",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "fixture-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "fixture-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "fixture-opponent-chain-quick", 1, 1), chainPassGroup(1, 1, 1)],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "chainResponse", effectId: "fixture-turn-open-quick" }],
            absentLegalActionGroups: [chainEffectGroup(0, "fixture-turn-open-quick", 1, 1)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-chain-quick" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro preserves restored opponent response priority after an open fast effect starts a chain",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "fixture-turn-open-quick", sourceUid: "p0-deck-100-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "fixture-opponent-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "fixture-opponent-chain-quick", 1, 1), chainPassGroup(1, 1, 1)],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "chainResponse", effectId: "fixture-turn-open-quick" }],
            absentLegalActionGroups: [chainEffectGroup(0, "fixture-turn-open-quick", 1, 1)],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the open fast-effect chain after the opponent chains the only response",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 6, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
              ], 1, 2),
              turnGroup(2),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-turn-open-quick" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 2,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-turn-open-quick" }],
              },
            ],
            logIncludes: ["Opponent chain quick resolved", "Turn open quick resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves chained open fast effects and returns to turn-player open priority",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        phase: "main1",
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 6, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "300", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "300", location: "hand" },
          ], 1, 2),
          turnGroup(2),
        ],
        absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-turn-open-quick" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 2,
            windowKind: "open",
            actions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "fixture-turn-open-quick" }],
          },
        ],
        logIncludes: ["Opponent chain quick resolved", "Turn open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
