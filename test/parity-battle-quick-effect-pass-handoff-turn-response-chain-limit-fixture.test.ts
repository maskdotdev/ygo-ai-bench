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

describe("EDOPro parity battle quick-effect pass handoff turn-response chain-limit fixture", () => {
  it("applies one-chain limits after the turn player responds to a damage-step pass handoff", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Handoff Limit Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Battle Handoff Limit Damage Step Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Battle Handoff Limit Opponent Blocked Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Battle Handoff Limit Turn Chain Limiter", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Battle Handoff Limit Turn Followup", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "damage step quick pass handoff turn-response chain limit fixture",
      options: { seed: 341, startingHandSize: 4 },
      decks: {
        0: { main: ["100", "300", "500", "600"] },
        1: { main: ["400", "400", "400", "400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-damage-step-handoff-limit-open-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "open",
            logMessage: "Fixture damage-step handoff limit open quick resolved",
          },
          {
            id: "fixture-turn-damage-step-handoff-chain-limiter",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "chain",
            chainLimitOnTarget: { untilChainEnd: false, allowPlayer: 0 },
            logMessage: "Fixture turn damage-step handoff chain limiter resolved",
          },
          {
            id: "fixture-turn-damage-step-handoff-limit-followup",
            player: 0,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture turn damage-step handoff limit followup should not resolve",
          },
          {
            id: "fixture-opponent-damage-step-handoff-limit-blocked",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture opponent damage-step handoff limit blocked quick should not resolve",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-damage-step-handoff-limit-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the opponent start-damage-step chain-response window restorable before the pass handoff",
            waitingFor: 1,
            windowId: 6,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-damage-step-handoff-limit-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [],
            chainLimits: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-handoff-limit-blocked", count: 1 },
              { type: "passChain", player: 1, windowId: 6, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-damage-step-handoff-limit-blocked", 1, 6),
              chainPassGroup(1, 1, 6),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "chainResponse", effectId: "fixture-damage-step-handoff-limit-open-quick" },
              { type: "passDamage", player: 1, windowId: 6, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-damage-step-handoff-limit-open-quick", 6, "chainResponse"),
              absentPassBattleGroup(1, "passDamage", 6),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro offers turn-player chain-only damage-step responses after the opponent passes the damage-step quick chain before limits apply",
            waitingFor: 0,
            windowId: 7,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-damage-step-handoff-limit-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [1],
            chainLimits: [],
            damagePasses: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-chain-limiter", count: 1 },
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-limit-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 7, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 7,
                windowKind: "chainResponse",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-chain-limiter", count: 1 },
                  { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-limit-followup", count: 1 },
                ],
              },
              chainPassGroup(0, 1, 7),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-damage-step-handoff-limit-open-quick" },
              { type: "passDamage", player: 0, windowId: 7, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-damage-step-handoff-limit-open-quick", 7, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 7),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-damage-step-handoff-chain-limiter" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the turn-player start-damage-step handoff response window restorable before one-chain limits apply",
            waitingFor: 0,
            windowId: 7,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-damage-step-handoff-limit-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [1],
            chainLimits: [],
            damagePasses: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-chain-limiter", count: 1 },
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-limit-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 7, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Effects",
                windowId: 7,
                windowKind: "chainResponse",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-chain-limiter", count: 1 },
                  { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-limit-followup", count: 1 },
                ],
              },
              chainPassGroup(0, 1, 7),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 7, windowKind: "chainResponse", effectId: "fixture-damage-step-handoff-limit-open-quick" },
              { type: "passDamage", player: 0, windowId: 7, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-damage-step-handoff-limit-open-quick", 7, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 7),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro applies one-chain SetChainLimit restrictions after the turn player responds to a damage-step quick pass handoff",
            waitingFor: 0,
            windowId: 8,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [
              { player: 0, effectId: "fixture-damage-step-handoff-limit-open-quick", sourceUid: "p0-deck-300-1" },
              { player: 0, effectId: "fixture-turn-damage-step-handoff-chain-limiter", sourceUid: "p0-deck-500-2" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 2 }],
            damagePasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-limit-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 8, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-turn-damage-step-handoff-limit-followup", 1, 8),
              chainPassGroup(0, 1, 8),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-handoff-limit-blocked" },
              { type: "passDamage", player: 0, windowId: 8, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-damage-step-handoff-limit-blocked", 8, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 8),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the damage-step SetChainLimit handoff response window restorable before the allowed turn player passes",
            waitingFor: 0,
            windowId: 8,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [
              { player: 0, effectId: "fixture-damage-step-handoff-limit-open-quick", sourceUid: "p0-deck-300-1" },
              { player: 0, effectId: "fixture-turn-damage-step-handoff-chain-limiter", sourceUid: "p0-deck-500-2" },
            ],
            chainPasses: [],
            chainLimits: [{ untilChainEnd: false, expiresAtChainLength: 2 }],
            damagePasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 8, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-handoff-limit-followup", count: 1 },
              { type: "passChain", player: 0, windowId: 8, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-turn-damage-step-handoff-limit-followup", 1, 8),
              chainPassGroup(0, 1, 8),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-handoff-limit-blocked" },
              { type: "passDamage", player: 0, windowId: 8, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-damage-step-handoff-limit-blocked", 8, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 8),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro clears one-chain limits and resumes the opponent damage-step response window after the allowed turn player passes the handoff chain",
        waitingFor: 1,
        windowId: 9,
        windowKind: "battle",
        pendingBattle: true,
        battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        chainLimits: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 9, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 9)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 9, windowKind: "battle", effectId: "fixture-damage-step-handoff-limit-open-quick" },
          { type: "activateEffect", player: 0, windowId: 9, windowKind: "battle", effectId: "fixture-turn-damage-step-handoff-chain-limiter" },
          { type: "activateEffect", player: 0, windowId: 9, windowKind: "battle", effectId: "fixture-turn-damage-step-handoff-limit-followup" },
          { type: "activateEffect", player: 1, windowId: 9, windowKind: "battle", effectId: "fixture-opponent-damage-step-handoff-limit-blocked" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-damage-step-handoff-limit-open-quick", 9, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-damage-step-handoff-chain-limiter", 9, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-damage-step-handoff-limit-followup", 9, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-step-handoff-limit-blocked", 9, "battle"),
        ],
        logIncludes: [
          "Fixture turn damage-step handoff chain limiter resolved",
          "Fixture damage-step handoff limit open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
