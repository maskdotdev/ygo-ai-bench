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

describe("EDOPro parity battle window attack-response quick pass handoff response chain-limit fixture", () => {
  it("applies one-chain limits after the opponent responds to an attack-response pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attack Response Handoff Limit Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Attack Response Handoff Limit Opponent Open Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Attack Response Handoff Limit Turn Blocked Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Attack Response Handoff Limit Opponent Chain Limiter", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Attack Response Handoff Limit Opponent Followup", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack response quick pass handoff response chain-limit fixture",
      options: { seed: 410, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["300", "500", "600"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-attack-handoff-limit-open-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Fixture opponent attack handoff limit open quick resolved",
          },
          {
            id: "fixture-opponent-attack-handoff-chain-limiter",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            chainLimitOnTarget: { untilChainEnd: false, allowPlayer: 1 },
            logMessage: "Fixture opponent attack handoff chain limiter resolved",
          },
          {
            id: "fixture-opponent-attack-handoff-limit-followup",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Fixture opponent attack handoff limit followup should not resolve",
          },
          {
            id: "fixture-turn-attack-handoff-limit-blocked",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Fixture turn attack handoff limit blocked quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro exposes opponent attack-response quick effects after attack declaration before one-chain limits can be created",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [],
            chainPasses: [],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-handoff-limit-open-quick", count: 1 },
              { type: "passAttack", player: 1, windowId: 2, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(1, "fixture-opponent-attack-handoff-limit-open-quick", 1, 2), passBattleGroup(1, "passAttack", 1, 2)],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-handoff-chain-limiter" },
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-handoff-limit-followup" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-chain-limiter", 2, "battle"),
              absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-limit-followup", 2, "battle"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-attack-handoff-limit-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers opponent chain-only attack-response effects after the turn player passes the opponent's quick chain before limits apply",
            waitingFor: 1,
            windowId: 4,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-attack-handoff-limit-open-quick", sourceUid: "p1-deck-300-0" }],
            chainPasses: [0],
            chainLimits: [],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 3 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-chain-limiter", count: 1 },
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-limit-followup", count: 1 },
              { type: "passChain", player: 1, windowId: 4, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 4,
                windowKind: "chainResponse",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-chain-limiter", count: 1 },
                  { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-limit-followup", count: 1 },
                ],
              },
              chainPassGroup(1, 1, 4),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-limit-open-quick" },
              { type: "passAttack", player: 1, windowId: 4, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-limit-open-quick", 4, "chainResponse"),
              absentPassBattleGroup(1, "passAttack", 4),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-attack-handoff-chain-limiter" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro applies one-chain SetChainLimit restrictions after the opponent responds to an attack-response pass handoff",
            waitingFor: 1,
            windowId: 5,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [
              { player: 1, effectId: "fixture-opponent-attack-handoff-limit-open-quick", sourceUid: "p1-deck-300-0" },
              { player: 1, effectId: "fixture-opponent-attack-handoff-chain-limiter", sourceUid: "p1-deck-500-1" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 2 }],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-limit-followup", count: 1 },
              { type: "passChain", player: 1, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-attack-handoff-limit-followup", 1, 5),
              chainPassGroup(1, 1, 5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-limit-blocked" },
              { type: "passAttack", player: 1, windowId: 5, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-turn-attack-handoff-limit-blocked", 5, "chainResponse"),
              absentPassBattleGroup(1, "passAttack", 5),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the attack-response SetChainLimit handoff response window restorable before the allowed opponent passes",
            waitingFor: 1,
            windowId: 5,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [
              { player: 1, effectId: "fixture-opponent-attack-handoff-limit-open-quick", sourceUid: "p1-deck-300-0" },
              { player: 1, effectId: "fixture-opponent-attack-handoff-chain-limiter", sourceUid: "p1-deck-500-1" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 2 }],
            attackPasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-limit-followup", count: 1 },
              { type: "passChain", player: 1, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-attack-handoff-limit-followup", 1, 5),
              chainPassGroup(1, 1, 5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-limit-blocked" },
              { type: "passAttack", player: 1, windowId: 5, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-turn-attack-handoff-limit-blocked", 5, "chainResponse"),
              absentPassBattleGroup(1, "passAttack", 5),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro clears one-chain limits and resumes the opponent attack-response window after the allowed opponent passes the handoff chain",
        waitingFor: 1,
        windowId: 6,
        windowKind: "battle",
        pendingBattle: true,
        battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        chainLimits: [],
        attackPasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passAttack", player: 1, windowId: 6, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passAttack", 1, 6)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "battle", effectId: "fixture-turn-attack-handoff-limit-blocked" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "battle", effectId: "fixture-opponent-attack-handoff-limit-open-quick" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "battle", effectId: "fixture-opponent-attack-handoff-chain-limiter" },
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "battle", effectId: "fixture-opponent-attack-handoff-limit-followup" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-turn-attack-handoff-limit-blocked", 6, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-limit-open-quick", 6, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-chain-limiter", 6, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-limit-followup", 6, "battle"),
        ],
        logIncludes: [
          "Fixture opponent attack handoff chain limiter resolved",
          "Fixture opponent attack handoff limit open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
