import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentPassBattleGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  effectGroup,
  passBattleGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle window attack-response quick pass handoff turn-response chain-limit fixture", () => {
  it("applies one-chain limits after the turn player responds to an attack-response pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attack Response Turn Handoff Limit Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Attack Response Turn Handoff Limit Open Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Attack Response Turn Handoff Limit Opponent Blocked Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Attack Response Turn Handoff Limit Chain Limiter", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Attack Response Turn Handoff Limit Followup", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack response quick pass handoff turn-response chain-limit fixture",
      options: { seed: 412, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "300", "500", "600"] },
        1: { main: ["400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-turn-attack-handoff-limit-open-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Fixture turn attack handoff limit open quick resolved",
          },
          {
            id: "fixture-turn-attack-handoff-chain-limiter",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            chainLimitOnTarget: { untilChainEnd: false, allowPlayer: 0 },
            logMessage: "Fixture turn attack handoff chain limiter resolved",
          },
          {
            id: "fixture-turn-attack-handoff-limit-followup",
            player: 0,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Fixture turn attack handoff limit followup should not resolve",
          },
          {
            id: "fixture-opponent-attack-handoff-limit-blocked",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Fixture opponent attack handoff limit blocked quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro lets the turn player respond after the opponent passes the attack-response window before one-chain limits apply",
            waitingFor: 0,
            windowId: 3,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [],
            chainPasses: [],
            attackPasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "battle", effectId: "fixture-turn-attack-handoff-limit-open-quick", count: 1 },
              { type: "passAttack", player: 0, windowId: 3, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(0, "fixture-turn-attack-handoff-limit-open-quick", 1, 3), passBattleGroup(0, "passAttack", 1, 3)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "battle", effectId: "fixture-turn-attack-handoff-chain-limiter" },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "battle", effectId: "fixture-turn-attack-handoff-limit-followup" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-turn-attack-handoff-chain-limiter", 3, "battle"),
              absentWindowEffectGroup(0, "fixture-turn-attack-handoff-limit-followup", 3, "battle"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-attack-handoff-limit-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers turn-player chain-only attack-response effects after the opponent passes the turn player's quick chain before limits apply",
            waitingFor: 0,
            windowId: 5,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-turn-attack-handoff-limit-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [1],
            chainLimits: [],
            attackPasses: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-chain-limiter", count: 1 },
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-limit-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 5,
                windowKind: "chainResponse",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-chain-limiter", count: 1 },
                  { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-limit-followup", count: 1 },
                ],
              },
              chainPassGroup(0, 1, 5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-limit-open-quick" },
              { type: "passAttack", player: 0, windowId: 5, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-turn-attack-handoff-limit-open-quick", 5, "chainResponse"),
              absentPassBattleGroup(0, "passAttack", 5),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-attack-handoff-chain-limiter" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro applies one-chain SetChainLimit restrictions after the turn player responds to an attack-response pass handoff",
            waitingFor: 0,
            windowId: 6,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [
              { player: 0, effectId: "fixture-turn-attack-handoff-limit-open-quick", sourceUid: "p0-deck-300-1" },
              { player: 0, effectId: "fixture-turn-attack-handoff-chain-limiter", sourceUid: "p0-deck-500-2" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 2 }],
            attackPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-limit-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-turn-attack-handoff-limit-followup", 1, 6),
              chainPassGroup(0, 1, 6),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-limit-blocked" },
              { type: "passAttack", player: 0, windowId: 6, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-limit-blocked", 6, "chainResponse"),
              absentPassBattleGroup(0, "passAttack", 6),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the turn-player attack-response SetChainLimit handoff response window restorable before the allowed turn player passes",
            waitingFor: 0,
            windowId: 6,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [
              { player: 0, effectId: "fixture-turn-attack-handoff-limit-open-quick", sourceUid: "p0-deck-300-1" },
              { player: 0, effectId: "fixture-turn-attack-handoff-chain-limiter", sourceUid: "p0-deck-500-2" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 2 }],
            attackPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-limit-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-turn-attack-handoff-limit-followup", 1, 6),
              chainPassGroup(0, 1, 6),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-limit-blocked" },
              { type: "passAttack", player: 0, windowId: 6, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-limit-blocked", 6, "chainResponse"),
              absentPassBattleGroup(0, "passAttack", 6),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro clears one-chain limits and resumes the opponent attack-response window after the allowed turn player passes the handoff chain",
        waitingFor: 1,
        windowId: 7,
        windowKind: "battle",
        pendingBattle: true,
        battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        chainLimits: [],
        attackPasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passAttack", player: 1, windowId: 7, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passAttack", 1, 7)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "battle", effectId: "fixture-turn-attack-handoff-limit-open-quick" },
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "battle", effectId: "fixture-turn-attack-handoff-chain-limiter" },
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "battle", effectId: "fixture-turn-attack-handoff-limit-followup" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "battle", effectId: "fixture-opponent-attack-handoff-limit-blocked" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-turn-attack-handoff-limit-open-quick", 7, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-attack-handoff-chain-limiter", 7, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-attack-handoff-limit-followup", 7, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-limit-blocked", 7, "battle"),
        ],
        logIncludes: [
          "Fixture turn attack handoff chain limiter resolved",
          "Fixture turn attack handoff limit open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
