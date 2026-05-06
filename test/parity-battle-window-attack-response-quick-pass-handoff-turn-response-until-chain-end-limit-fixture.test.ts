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

describe("EDOPro parity battle window attack-response quick pass handoff turn-response until-chain-end limit fixture", () => {
  it("keeps until-chain-end limits after the turn player responds to an attack-response pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attack Response Turn Handoff Until Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Attack Response Turn Handoff Until Open Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Attack Response Turn Handoff Until Opponent Blocked Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Attack Response Turn Handoff Until Chain Limiter", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Attack Response Turn Handoff Until Followup", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack response quick pass handoff turn-response until-chain-end limit fixture",
      options: { seed: 413, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "300", "500", "600"] },
        1: { main: ["400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-turn-attack-handoff-until-open-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "open",
            logMessage: "Fixture turn attack handoff until open quick resolved",
          },
          {
            id: "fixture-turn-attack-handoff-until-chain-limiter",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            activationChain: "chain",
            chainLimitOnTarget: { untilChainEnd: true, allowPlayer: 0 },
            logMessage: "Fixture turn attack handoff until chain limiter resolved",
          },
          {
            id: "fixture-turn-attack-handoff-until-followup",
            player: 0,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Fixture turn attack handoff until followup should not resolve",
          },
          {
            id: "fixture-opponent-attack-handoff-until-blocked",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            activationChain: "chain",
            logMessage: "Fixture opponent attack handoff until blocked quick should not resolve",
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
            note: "EDOPro lets the turn player respond after the opponent passes the attack-response window before until-chain-end limits apply",
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
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "battle", effectId: "fixture-turn-attack-handoff-until-open-quick", count: 1 },
              { type: "passAttack", player: 0, windowId: 3, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(0, "fixture-turn-attack-handoff-until-open-quick", 1, 3), passBattleGroup(0, "passAttack", 1, 3)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "battle", effectId: "fixture-turn-attack-handoff-until-chain-limiter" },
              { type: "activateEffect", player: 0, windowId: 3, windowKind: "battle", effectId: "fixture-turn-attack-handoff-until-followup" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-turn-attack-handoff-until-chain-limiter", 3, "battle"),
              absentWindowEffectGroup(0, "fixture-turn-attack-handoff-until-followup", 3, "battle"),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-attack-handoff-until-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers turn-player chain-only attack-response effects after the opponent passes the turn player's quick chain before until-chain-end limits apply",
            waitingFor: 0,
            windowId: 5,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-turn-attack-handoff-until-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [1],
            chainLimits: [],
            attackPasses: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-until-chain-limiter", count: 1 },
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-until-followup", count: 1 },
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
                  { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-until-chain-limiter", count: 1 },
                  { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-until-followup", count: 1 },
                ],
              },
              chainPassGroup(0, 1, 5),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-until-open-quick" },
              { type: "passAttack", player: 0, windowId: 5, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-turn-attack-handoff-until-open-quick", 5, "chainResponse"),
              absentPassBattleGroup(0, "passAttack", 5),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-attack-handoff-until-chain-limiter" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro applies SetChainLimitTillChainEnd restrictions after the turn player responds to an attack-response pass handoff",
            waitingFor: 0,
            windowId: 6,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [
              { player: 0, effectId: "fixture-turn-attack-handoff-until-open-quick", sourceUid: "p0-deck-300-1" },
              { player: 0, effectId: "fixture-turn-attack-handoff-until-chain-limiter", sourceUid: "p0-deck-500-2" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: true }],
            attackPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-until-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-turn-attack-handoff-until-followup", 1, 6),
              chainPassGroup(0, 1, 6),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-until-blocked" },
              { type: "passAttack", player: 0, windowId: 6, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-until-blocked", 6, "chainResponse"),
              absentPassBattleGroup(0, "passAttack", 6),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the turn-player attack-response SetChainLimitTillChainEnd handoff response window restorable before the allowed turn player passes",
            waitingFor: 0,
            windowId: 6,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [
              { player: 0, effectId: "fixture-turn-attack-handoff-until-open-quick", sourceUid: "p0-deck-300-1" },
              { player: 0, effectId: "fixture-turn-attack-handoff-until-chain-limiter", sourceUid: "p0-deck-500-2" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: true }],
            attackPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-turn-attack-handoff-until-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-turn-attack-handoff-until-followup", 1, 6),
              chainPassGroup(0, 1, 6),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-attack-handoff-until-blocked" },
              { type: "passAttack", player: 0, windowId: 6, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-until-blocked", 6, "chainResponse"),
              absentPassBattleGroup(0, "passAttack", 6),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro clears until-chain-end limits and resumes the opponent attack-response window after the allowed turn player passes the handoff chain",
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
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "battle", effectId: "fixture-turn-attack-handoff-until-open-quick" },
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "battle", effectId: "fixture-turn-attack-handoff-until-chain-limiter" },
          { type: "activateEffect", player: 0, windowId: 7, windowKind: "battle", effectId: "fixture-turn-attack-handoff-until-followup" },
          { type: "activateEffect", player: 1, windowId: 7, windowKind: "battle", effectId: "fixture-opponent-attack-handoff-until-blocked" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-turn-attack-handoff-until-open-quick", 7, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-attack-handoff-until-chain-limiter", 7, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-attack-handoff-until-followup", 7, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-attack-handoff-until-blocked", 7, "battle"),
        ],
        logIncludes: [
          "Fixture turn attack handoff until chain limiter resolved",
          "Fixture turn attack handoff until open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
