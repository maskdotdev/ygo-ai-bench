import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  absentPassBattleGroup,
  absentWindowEffectGroup,
  chainEffectGroup,
  chainPassGroup,
  passDamageGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity damage-calculation quick-effect pass handoff turn-response until-chain-end limit fixture", () => {
  it("keeps until-chain-end limits after the turn player responds to a damage-calculation pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Damage Calculation Handoff Until Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Damage Calculation Handoff Until Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Damage Calculation Handoff Until Opponent Blocked Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Damage Calculation Handoff Until Turn Chain Limiter", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Damage Calculation Handoff Until Turn Followup", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "damage calculation quick pass handoff turn-response until-chain-end limit fixture",
      options: { seed: 344, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "300", "500", "600"] },
        1: { main: ["400", "400", "400", "400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-damage-calculation-handoff-until-open-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            activationChain: "open",
            logMessage: "Fixture damage-calculation handoff until open quick resolved",
          },
          {
            id: "fixture-turn-damage-calculation-handoff-until-chain-limiter",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            activationChain: "chain",
            chainLimitOnTarget: { untilChainEnd: true, allowPlayer: 0 },
            logMessage: "Fixture turn damage-calculation handoff until chain limiter resolved",
          },
          {
            id: "fixture-turn-damage-calculation-handoff-until-followup",
            player: 0,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x8000,
            activationChain: "chain",
            logMessage: "Fixture turn damage-calculation handoff until followup should not resolve",
          },
          {
            id: "fixture-opponent-damage-calculation-handoff-until-blocked",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x8000,
            activationChain: "chain",
            logMessage: "Fixture opponent damage-calculation handoff until blocked quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-damage-calculation-handoff-until-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers turn-player chain-only damage-calculation responses after the opponent passes the damage-calculation quick chain before until-chain-end limits apply",
            waitingFor: 0,
            windowId: 11,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-damage-calculation-handoff-until-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [1],
            chainLimits: [],
            damagePasses: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 11, windowKind: "chainResponse", effectId: "fixture-turn-damage-calculation-handoff-until-chain-limiter", count: 1 },
              { type: "activateEffect", player: 0, windowId: 11, windowKind: "chainResponse", effectId: "fixture-turn-damage-calculation-handoff-until-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 11, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 11,
                windowKind: "chainResponse",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 0, windowId: 11, windowKind: "chainResponse", effectId: "fixture-turn-damage-calculation-handoff-until-chain-limiter", count: 1 },
                  { type: "activateEffect", player: 0, windowId: 11, windowKind: "chainResponse", effectId: "fixture-turn-damage-calculation-handoff-until-followup", count: 1 },
                ],
              },
              chainPassGroup(0, 1, 11),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 11, windowKind: "chainResponse", effectId: "fixture-damage-calculation-handoff-until-open-quick" },
              { type: "passDamage", player: 0, windowId: 11, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-damage-calculation-handoff-until-open-quick", 11, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 11),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-damage-calculation-handoff-until-chain-limiter" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro applies SetChainLimitTillChainEnd restrictions after the turn player responds to a damage-calculation quick pass handoff",
            waitingFor: 0,
            windowId: 12,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [
              { player: 0, effectId: "fixture-damage-calculation-handoff-until-open-quick", sourceUid: "p0-deck-300-1" },
              { player: 0, effectId: "fixture-turn-damage-calculation-handoff-until-chain-limiter", sourceUid: "p0-deck-500-2" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: true }],
            damagePasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 12, windowKind: "chainResponse", effectId: "fixture-turn-damage-calculation-handoff-until-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 12, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-turn-damage-calculation-handoff-until-followup", 1, 12),
              chainPassGroup(0, 1, 12),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 12, windowKind: "chainResponse", effectId: "fixture-opponent-damage-calculation-handoff-until-blocked" },
              { type: "passDamage", player: 0, windowId: 12, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-handoff-until-blocked", 12, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 12),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the damage-calculation SetChainLimitTillChainEnd handoff response window restorable before the allowed turn player passes",
            waitingFor: 0,
            windowId: 12,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [
              { player: 0, effectId: "fixture-damage-calculation-handoff-until-open-quick", sourceUid: "p0-deck-300-1" },
              { player: 0, effectId: "fixture-turn-damage-calculation-handoff-until-chain-limiter", sourceUid: "p0-deck-500-2" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: true }],
            damagePasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 12, windowKind: "chainResponse", effectId: "fixture-turn-damage-calculation-handoff-until-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 12, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-turn-damage-calculation-handoff-until-followup", 1, 12),
              chainPassGroup(0, 1, 12),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 12, windowKind: "chainResponse", effectId: "fixture-opponent-damage-calculation-handoff-until-blocked" },
              { type: "passDamage", player: 0, windowId: 12, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-handoff-until-blocked", 12, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 12),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro clears until-chain-end limits and resumes the opponent damage-calculation response window after the allowed turn player passes the handoff chain",
        waitingFor: 1,
        windowId: 13,
        windowKind: "battle",
        pendingBattle: true,
        battleStep: "damageCalculation",
        battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        chainLimits: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 13, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 13)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 13, windowKind: "battle", effectId: "fixture-damage-calculation-handoff-until-open-quick" },
          { type: "activateEffect", player: 0, windowId: 13, windowKind: "battle", effectId: "fixture-turn-damage-calculation-handoff-until-chain-limiter" },
          { type: "activateEffect", player: 0, windowId: 13, windowKind: "battle", effectId: "fixture-turn-damage-calculation-handoff-until-followup" },
          { type: "activateEffect", player: 1, windowId: 13, windowKind: "battle", effectId: "fixture-opponent-damage-calculation-handoff-until-blocked" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-damage-calculation-handoff-until-open-quick", 13, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-damage-calculation-handoff-until-chain-limiter", 13, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-damage-calculation-handoff-until-followup", 13, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-handoff-until-blocked", 13, "battle"),
        ],
        logIncludes: [
          "Fixture turn damage-calculation handoff until chain limiter resolved",
          "Fixture damage-calculation handoff until open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
