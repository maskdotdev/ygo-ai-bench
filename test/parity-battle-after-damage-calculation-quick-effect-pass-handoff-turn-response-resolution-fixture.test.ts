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

describe("EDOPro parity after-damage-calculation quick-effect pass handoff turn response resolution fixture", () => {
  it("resolves turn-player after-damage-calculation pass-handoff chains after the opponent passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "After Damage Calculation Handoff Resolution Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "After Damage Calculation Handoff Resolution Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "After Damage Calculation Handoff Resolution Opponent Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "After Damage Calculation Handoff Resolution Turn Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "after damage calculation quick pass handoff turn response resolution fixture",
      options: { seed: 411, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-after-damage-calculation-handoff-resolution-open-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "open",
            logMessage: "Fixture after-damage-calculation handoff resolution open quick resolved",
          },
          {
            id: "fixture-opponent-after-damage-calculation-handoff-resolution-chain-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture opponent after-damage-calculation handoff resolution chain quick should not resolve",
          },
          {
            id: "fixture-turn-after-damage-calculation-handoff-resolution-chain-quick",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture turn after-damage-calculation handoff resolution chain quick resolved",
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
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-after-damage-calculation-handoff-resolution-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the opponent after-damage-calculation chain pass restorable before turn-player chain responses reopen",
            waitingFor: 1,
            windowId: 12,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damage",
            battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-after-damage-calculation-handoff-resolution-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 12, windowKind: "chainResponse", effectId: "fixture-opponent-after-damage-calculation-handoff-resolution-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 12, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-after-damage-calculation-handoff-resolution-chain-quick", 1, 12),
              chainPassGroup(1, 1, 12),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 12, windowKind: "chainResponse", effectId: "fixture-after-damage-calculation-handoff-resolution-open-quick" },
              { type: "passDamage", player: 1, windowId: 12, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-after-damage-calculation-handoff-resolution-open-quick", 12, "chainResponse"),
              absentPassBattleGroup(1, "passDamage", 12),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro offers turn-player chain-only after-damage-calculation responses after the opponent passes the quick chain",
            waitingFor: 0,
            windowId: 13,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damage",
            battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-after-damage-calculation-handoff-resolution-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [1],
            damagePasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 13, windowKind: "chainResponse", effectId: "fixture-turn-after-damage-calculation-handoff-resolution-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 13, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-turn-after-damage-calculation-handoff-resolution-chain-quick", 1, 13),
              chainPassGroup(0, 1, 13),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 13, windowKind: "chainResponse", effectId: "fixture-after-damage-calculation-handoff-resolution-open-quick" },
              { type: "passDamage", player: 0, windowId: 13, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-after-damage-calculation-handoff-resolution-open-quick", 13, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 13),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-after-damage-calculation-handoff-resolution-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the opponent pass restorable before resolving the turn-player after-damage response chain",
            waitingFor: 1,
            windowId: 14,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damage",
            battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [
              { player: 0, effectId: "fixture-after-damage-calculation-handoff-resolution-open-quick", sourceUid: "p0-deck-300-1" },
              { player: 0, effectId: "fixture-turn-after-damage-calculation-handoff-resolution-chain-quick", sourceUid: "p0-deck-500-2" },
            ],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 14, windowKind: "chainResponse", effectId: "fixture-opponent-after-damage-calculation-handoff-resolution-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 14, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-after-damage-calculation-handoff-resolution-chain-quick", 1, 14),
              chainPassGroup(1, 1, 14),
            ],
            absentLegalActions: [{ type: "passDamage", player: 1, windowId: 14, windowKind: "battle" }],
            absentLegalActionGroups: [absentPassBattleGroup(1, "passDamage", 14)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves turn-player after-damage-calculation pass-handoff chains after the opponent passes the reopened response window",
        waitingFor: 1,
        windowId: 15,
        windowKind: "battle",
        pendingBattle: true,
        battleStep: "damage",
        battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 15, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 15)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 15, windowKind: "battle", effectId: "fixture-after-damage-calculation-handoff-resolution-open-quick" },
          { type: "activateEffect", player: 0, windowId: 15, windowKind: "battle", effectId: "fixture-turn-after-damage-calculation-handoff-resolution-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 15, windowKind: "battle", effectId: "fixture-opponent-after-damage-calculation-handoff-resolution-chain-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-after-damage-calculation-handoff-resolution-open-quick", 15, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-after-damage-calculation-handoff-resolution-chain-quick", 15, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-after-damage-calculation-handoff-resolution-chain-quick", 15, "battle"),
        ],
        logIncludes: [
          "Fixture turn after-damage-calculation handoff resolution chain quick resolved",
          "Fixture after-damage-calculation handoff resolution open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
