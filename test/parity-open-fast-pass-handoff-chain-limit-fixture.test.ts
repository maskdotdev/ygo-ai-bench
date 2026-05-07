import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentChainEffectGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup, summonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity open fast-effect pass-handoff chain-limit fixture", () => {
  it("applies one-chain limits after the turn player chains from an open fast-effect pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Open Handoff Limit Turn Open Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "130", name: "Open Handoff Limit Turn Chain Limiter", kind: "monster", attack: 1000, defense: 1000 },
      { code: "140", name: "Open Handoff Limit Turn Followup", kind: "monster", attack: 1000, defense: 1000 },
      { code: "210", name: "Open Handoff Limit Opponent Blocked Quick", kind: "monster", attack: 1000, defense: 1000 },
      { code: "220", name: "Open Handoff Limit Opponent Filler", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "open fast pass-handoff chain limit fixture",
      options: { seed: 497, startingHandSize: 3 },
      decks: {
        0: { main: ["110", "130", "140"] },
        1: { main: ["210", "220", "220"] },
      },
      setup: {
        effects: [
          {
            id: "open-handoff-limit-turn-open-quick",
            player: 0,
            code: "110",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "open",
            oncePerTurn: true,
            logMessage: "Open handoff limit turn open quick resolved",
          },
          {
            id: "open-handoff-limit-turn-chain-limiter",
            player: 0,
            code: "130",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            oncePerTurn: true,
            chainLimitOnTarget: { untilChainEnd: false, allowPlayer: 0 },
            logMessage: "Open handoff limit turn chain limiter resolved",
          },
          {
            id: "open-handoff-limit-turn-followup",
            player: 0,
            code: "140",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Open handoff limit turn followup should not resolve",
          },
          {
            id: "open-handoff-limit-opponent-blocked",
            player: 1,
            code: "210",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Open handoff limit opponent blocked quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-handoff-limit-turn-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "open-handoff-limit-turn-chain-limiter" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro applies one-chain SetChainLimit restrictions after the turn player chains from an open fast-effect pass handoff",
            phase: "main1",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "open-handoff-limit-turn-open-quick", sourceUid: "p0-deck-110-0" },
              { player: 0, effectId: "open-handoff-limit-turn-chain-limiter", sourceUid: "p0-deck-130-1" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 2 }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "open-handoff-limit-turn-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "open-handoff-limit-turn-followup", 1, 3),
              chainPassGroup(0, 1, 3),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-handoff-limit-opponent-blocked" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "open-handoff-limit-opponent-blocked", 3)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the open fast-effect pass-handoff SetChainLimit window restorable before the allowed turn player passes",
            phase: "main1",
            windowId: 3,
            windowKind: "chainResponse",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [
              { player: 0, effectId: "open-handoff-limit-turn-open-quick", sourceUid: "p0-deck-110-0" },
              { player: 0, effectId: "open-handoff-limit-turn-chain-limiter", sourceUid: "p0-deck-130-1" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 2 }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "chainResponse", effectId: "open-handoff-limit-turn-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 3, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "open-handoff-limit-turn-followup", 1, 3),
              chainPassGroup(0, 1, 3),
            ],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowId: 3, windowKind: "chainResponse", effectId: "open-handoff-limit-opponent-blocked" }],
            absentLegalActionGroups: [absentChainEffectGroup(1, "open-handoff-limit-opponent-blocked", 3)],
          },
          after: {
            source: "edopro",
            note: "EDOPro clears one-chain limits and resolves open fast-effect pass-handoff chains after the allowed turn player passes",
            phase: "main1",
            windowId: 4,
            windowKind: "open",
            waitingFor: 0,
            pendingTriggers: [],
            pendingTriggerBuckets: [],
            chain: [],
            chainPasses: [],
            chainLimits: [],
            legalActionCounts: { 0: 8, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "110", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "130", location: "hand", count: 1 },
              { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "140", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "110", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "130", location: "hand", count: 1 },
              { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "140", location: "hand", count: 1 },
              { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              summonGroup([
                { type: "normalSummon", player: 0, code: "110", location: "hand" },
                { type: "normalSummon", player: 0, code: "130", location: "hand" },
                { type: "normalSummon", player: 0, code: "140", location: "hand" },
                { type: "setMonster", player: 0, code: "110", location: "hand" },
                { type: "setMonster", player: 0, code: "130", location: "hand" },
                { type: "setMonster", player: 0, code: "140", location: "hand" },
              ], 1, 4),
              turnGroup(4),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "open-handoff-limit-turn-open-quick" },
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "open-handoff-limit-turn-chain-limiter" },
              { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "open-handoff-limit-turn-followup" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "open-handoff-limit-turn-open-quick", 4, "open"),
              absentWindowEffectGroup(0, "open-handoff-limit-turn-chain-limiter", 4, "open"),
              absentWindowEffectGroup(0, "open-handoff-limit-turn-followup", 4, "open"),
            ],
            logIncludes: ["Open handoff limit turn chain limiter resolved", "Open handoff limit turn open quick resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final state clears one-chain limits after resolving the open fast-effect pass-handoff chain",
        phase: "main1",
        windowId: 4,
        windowKind: "open",
        waitingFor: 0,
        pendingTriggers: [],
        pendingTriggerBuckets: [],
        chain: [],
        chainPasses: [],
        chainLimits: [],
        legalActionCounts: { 0: 8, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "130", location: "hand", count: 1 },
          { type: "normalSummon", player: 0, windowId: 4, windowKind: "open", code: "140", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "110", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "130", location: "hand", count: 1 },
          { type: "setMonster", player: 0, windowId: 4, windowKind: "open", code: "140", location: "hand", count: 1 },
          { type: "changePhase", player: 0, windowId: 4, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 4, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          summonGroup([
            { type: "normalSummon", player: 0, code: "110", location: "hand" },
            { type: "normalSummon", player: 0, code: "130", location: "hand" },
            { type: "normalSummon", player: 0, code: "140", location: "hand" },
            { type: "setMonster", player: 0, code: "110", location: "hand" },
            { type: "setMonster", player: 0, code: "130", location: "hand" },
            { type: "setMonster", player: 0, code: "140", location: "hand" },
          ], 1, 4),
          turnGroup(4),
        ],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "open-handoff-limit-turn-open-quick" },
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "open-handoff-limit-turn-chain-limiter" },
          { type: "activateEffect", player: 0, windowId: 4, windowKind: "open", effectId: "open-handoff-limit-turn-followup" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "open-handoff-limit-turn-open-quick", 4, "open"),
          absentWindowEffectGroup(0, "open-handoff-limit-turn-chain-limiter", 4, "open"),
          absentWindowEffectGroup(0, "open-handoff-limit-turn-followup", 4, "open"),
        ],
        logIncludes: ["Open handoff limit turn chain limiter resolved", "Open handoff limit turn open quick resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
