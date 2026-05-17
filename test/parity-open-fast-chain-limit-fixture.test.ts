import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect chain-limit fixtures", () => {
  it("expires one-chain limits after an open fast-effect chain resolves", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Open Chain Limiter", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Opponent Blocked Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Turn Allowed Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "400", name: "Turn Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast one-chain limit fixture",
      options: { seed: 266, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "400"] },
        1: { main: ["200", "400", "400"] },
      },
      setup: {
        effects: [
          {
            id: "open-fast-chain-limiter",
            player: 0,
            code: "100",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            oncePerTurn: true,
            chainLimitOnTarget: { untilChainEnd: false, allowPlayer: 0 },
            logMessage: "Open chain limiter resolved",
          },
          {
            id: "open-fast-turn-followup",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Turn allowed chain quick resolved",
          },
          {
            id: "open-fast-opponent-blocked",
            player: 1,
            code: "200",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Opponent blocked chain quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-chain-limiter" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps initial turn-player open priority restorable before applying the one-chain SetChainLimit",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainLimits: [],
            legalActionCounts: { 0: 9, 1: 0 },
            legalActionGroupCounts: { 0: 3, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "open-fast-chain-limiter", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 0, windowKind: "open", code: "400", location: "hand", count: 1 },
            ],
            legalActionGroups: [
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
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: "open-fast-turn-followup" },
              { type: "activateEffect", player: 1, windowId: 0, windowKind: "open", effectId: "open-fast-opponent-blocked" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "open-fast-turn-followup", 0, "open"),
              absentWindowEffectGroup(1, "open-fast-opponent-blocked", 0, "open"),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro applies one-chain SetChainLimit restrictions after an open fast effect is placed on chain",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "open-fast-chain-limiter", sourceUid: "p0-deck-100-0" }],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 1 }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-turn-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "open-fast-turn-followup", 1, 1), chainPassGroup(0, 1, 1)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-opponent-blocked" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "open-fast-opponent-blocked", 1)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the one-chain SetChainLimit response window restorable before the restricted player passes",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 0,
            chain: [{ player: 0, effectId: "open-fast-chain-limiter", sourceUid: "p0-deck-100-0" }],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 1 }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-turn-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "open-fast-turn-followup", 1, 1), chainPassGroup(0, 1, 1)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-opponent-blocked" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "open-fast-opponent-blocked", 1)],
          },
          after: {
            source: "edopro",
            note: "EDOPro clears one-chain SetChainLimit restrictions after the restricted open fast-effect chain resolves",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainLimits: [],
            legalActionCounts: { 0: 8, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "300", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "100", location: "hand" },
                { type: "normalSummon", player: 0, code: "300", location: "hand" },
                { type: "normalSummon", player: 0, code: "400", location: "hand" },
                { type: "setMonster", player: 0, code: "100", location: "hand" },
                { type: "setMonster", player: 0, code: "300", location: "hand" },
                { type: "setMonster", player: 0, code: "400", location: "hand" },
              ], 1, 2),
              turnGroup(2),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "open-fast-chain-limiter" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 2,
                windowKind: "open",
                actions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "open-fast-chain-limiter" }],
              },
            ],
            logIncludes: ["Open chain limiter resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state leaves one-chain limits expired after resolving the open fast-effect chain",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        chainPasses: [],
        chainLimits: [],
        legalActionCounts: { 0: 8, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "100", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "300", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 2, windowKind: "open", code: "400", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "100", location: "hand" },
            { type: "normalSummon", player: 0, code: "300", location: "hand" },
            { type: "normalSummon", player: 0, code: "400", location: "hand" },
            { type: "setMonster", player: 0, code: "100", location: "hand" },
            { type: "setMonster", player: 0, code: "300", location: "hand" },
            { type: "setMonster", player: 0, code: "400", location: "hand" },
          ], 1, 2),
          turnGroup(2),
        ],
        absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "open-fast-chain-limiter" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Effects",
            windowId: 2,
            windowKind: "open",
            actions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "open-fast-chain-limiter" }],
          },
        ],
        logIncludes: ["Open chain limiter resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
