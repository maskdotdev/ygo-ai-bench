import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup, summonGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity end turn open fast-effect pass resolution fixture", () => {
  it("resolves new-turn open fast effects after the previous turn player passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Previous Turn Open Quick Pass", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Next Turn Open Quick Pass", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Next Turn Pass Filler", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Previous Turn Chain Quick Pass", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "end turn open fast pass resolution fixture",
      options: { seed: 267, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300", "400"] },
        1: { main: ["200", "300"] },
      },
      setup: {
        effects: [
          {
            id: "end-turn-pass-previous-open-quick",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            logMessage: "Previous turn open quick should not be offered",
          },
          {
            id: "end-turn-pass-next-open-quick",
            player: 1,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Next turn open quick pass resolved",
          },
          {
            id: "end-turn-pass-previous-chain-quick",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            logMessage: "Previous turn chain quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("endTurn", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro hands End Turn priority to the next turn player's open fast-effect window",
            windowId: 1,
            windowKind: "open",
            phase: "main1",
            turnPlayer: 1,
            turn: 2,
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 7 },
            legalActionGroupCounts: { 0: 0, 1: 3 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "end-turn-pass-next-open-quick", count: 1 },
              { type: "normalSummon", player: 1, windowId: 1, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "normalSummon", player: 1, windowId: 1, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 1, windowId: 1, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "setMonster", player: 1, windowId: 1, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "changePhase", player: 1, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 1,
                windowKind: "open",
                count: 1,
                actions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "open", effectId: "end-turn-pass-next-open-quick", count: 1 }],
              },
              summonGroup([
                { type: "normalSummon", player: 1, code: "200", location: "hand" },
                { type: "normalSummon", player: 1, code: "300", location: "hand" },
                { type: "setMonster", player: 1, code: "200", location: "hand" },
                { type: "setMonster", player: 1, code: "300", location: "hand" },
              ], 1, 1),
              {
                player: 1,
                label: "Turn",
                windowId: 1,
                windowKind: "open",
                actions: [
                  { type: "changePhase", player: 1, windowId: 1, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 1, windowId: 1, windowKind: "open", count: 1 },
                ],
              },
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "end-turn-pass-previous-open-quick" },
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "open", effectId: "end-turn-pass-previous-chain-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "end-turn-pass-previous-open-quick", 1, "open"),
              absentWindowEffectGroup(0, "end-turn-pass-previous-chain-quick", 1, "open"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "end-turn-pass-next-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro restores the previous turn player's chain-response window after the new turn player starts an open fast-effect chain",
            windowId: 2,
            windowKind: "chainResponse",
            phase: "main1",
            turnPlayer: 1,
            turn: 2,
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [{ player: 1, effectId: "end-turn-pass-next-open-quick", sourceUid: "p1-deck-200-0" }],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "end-turn-pass-previous-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 2, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "end-turn-pass-previous-chain-quick", 1, 2),
              chainPassGroup(0, 1, 2),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 2, windowKind: "chainResponse", effectId: "end-turn-pass-previous-open-quick" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "chainResponse", effectId: "end-turn-pass-next-open-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "end-turn-pass-previous-open-quick", 2, "chainResponse"),
              absentWindowEffectGroup(1, "end-turn-pass-next-open-quick", 2, "chainResponse"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves the new turn player's open fast-effect chain when the previous turn player passes and no further response exists",
            windowId: 3,
            windowKind: "open",
            phase: "main1",
            turnPlayer: 1,
            turn: 2,
            waitingFor: 1,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            legalActionCounts: { 0: 0, 1: 6 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "normalSummon", player: 1, windowId: 3, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "normalSummon", player: 1, windowId: 3, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 1, windowId: 3, windowKind: "open", code: "200", location: "hand", count: 1 },
              { type: "setMonster", player: 1, windowId: 3, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "changePhase", player: 1, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 1, code: "200", location: "hand" },
                { type: "normalSummon", player: 1, code: "300", location: "hand" },
                { type: "setMonster", player: 1, code: "200", location: "hand" },
                { type: "setMonster", player: 1, code: "300", location: "hand" },
              ], 1, 3),
              {
                player: 1,
                label: "Turn",
                windowId: 3,
                windowKind: "open",
                actions: [
                  { type: "changePhase", player: 1, windowId: 3, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 1, windowId: 3, windowKind: "open", count: 1 },
                ],
              },
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "end-turn-pass-next-open-quick" },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "end-turn-pass-previous-open-quick" },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "end-turn-pass-previous-chain-quick" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "end-turn-pass-next-open-quick", 3, "open"),
              absentWindowEffectGroup(0, "end-turn-pass-previous-open-quick", 3, "open"),
              absentWindowEffectGroup(0, "end-turn-pass-previous-chain-quick", 3, "open"),
            ],
            logIncludes: ["Next turn open quick pass resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state returns to the next turn player's open priority after the previous turn player passes the turn-handoff fast-effect chain",
        windowId: 3,
        windowKind: "open",
        phase: "main1",
        turnPlayer: 1,
        turn: 2,
        waitingFor: 1,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        legalActionCounts: { 0: 0, 1: 6 },
        legalActionGroupCounts: { 0: 0, 1: 2 },
        legalActions: [
          { type: "normalSummon", player: 1, windowId: 3, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "normalSummon", player: 1, windowId: 3, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "setMonster", player: 1, windowId: 3, windowKind: "open", code: "200", location: "hand", count: 1 },
          { type: "setMonster", player: 1, windowId: 3, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "changePhase", player: 1, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 1, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 1, code: "200", location: "hand" },
            { type: "normalSummon", player: 1, code: "300", location: "hand" },
            { type: "setMonster", player: 1, code: "200", location: "hand" },
            { type: "setMonster", player: 1, code: "300", location: "hand" },
          ], 1, 3),
          {
            player: 1,
            label: "Turn",
            windowId: 3,
            windowKind: "open",
            actions: [
              { type: "changePhase", player: 1, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 3, windowKind: "open", count: 1 },
            ],
          },
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 1, windowId: 3, windowKind: "open", effectId: "end-turn-pass-next-open-quick" },
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "end-turn-pass-previous-open-quick" },
          { type: "activateEffect", player: 0, windowId: 3, windowKind: "open", effectId: "end-turn-pass-previous-chain-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(1, "end-turn-pass-next-open-quick", 3, "open"),
          absentWindowEffectGroup(0, "end-turn-pass-previous-open-quick", 3, "open"),
          absentWindowEffectGroup(0, "end-turn-pass-previous-chain-quick", 3, "open"),
        ],
        logIncludes: ["Next turn open quick pass resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
