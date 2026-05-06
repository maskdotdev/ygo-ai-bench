import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { chainEffectGroup, chainPassGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

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
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: true,
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
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "open-fast-chain-limiter" }],
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
        chainLimits: [],
        legalActionCounts: { 0: 8, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
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
        logIncludes: ["Open chain limiter resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("keeps until-chain-end limits for the full open fast-effect response chain", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Open Until Chain End Limiter", kind: "monster", attack: 1000, defense: 1000 },
      { code: "210", name: "Opponent Allowed Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "310", name: "Turn Blocked Chain Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "410", name: "Until Chain Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast until-chain-end limit fixture",
      options: { seed: 267, startingHandSize: 3 },
      decks: {
        0: { main: ["110", "310", "410"] },
        1: { main: ["210", "410", "410"] },
      },
      setup: {
        effects: [
          {
            id: "open-fast-until-limiter",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            oncePerTurn: true,
            chainLimitOnTarget: { untilChainEnd: true, allowPlayer: 1 },
            logMessage: "Open until-chain-end limiter resolved",
          },
          {
            id: "open-fast-opponent-allowed",
            player: 1,
            code: "210",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            oncePerTurn: true,
            logMessage: "Opponent allowed chain quick resolved",
          },
          {
            id: "open-fast-turn-blocked",
            player: 0,
            code: "310",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Turn blocked chain quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-fast-until-limiter" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro keeps SetChainLimitTillChainEnd restrictions active across the open fast-effect response chain",
            windowId: 1,
            windowKind: "chainResponse",
            waitingFor: 1,
            chain: [{ player: 0, effectId: "open-fast-until-limiter", sourceUid: "p0-deck-110-0" }],
            chainLimits: [{ untilChainEnd: true }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-opponent-allowed", count: 1 },
              { type: "passChain", player: 1, windowId: 1, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "open-fast-opponent-allowed", 1, 1), chainPassGroup(1, 1, 1)],
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 1, windowKind: "chainResponse", effectId: "open-fast-turn-blocked" }],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "open-fast-opponent-allowed" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves the chain when until-chain-end restrictions leave no legal turn-player response",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            chain: [],
            chainLimits: [],
            legalActionCounts: { 0: 8, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: "open-fast-turn-blocked" }],
            logIncludes: ["Opponent allowed chain quick resolved", "Open until-chain-end limiter resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state clears until-chain-end limits after resolving the open fast-effect chain",
        windowId: 2,
        windowKind: "open",
        waitingFor: 0,
        chain: [],
        chainLimits: [],
        legalActionCounts: { 0: 8, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        logIncludes: ["Opponent allowed chain quick resolved", "Open until-chain-end limiter resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
