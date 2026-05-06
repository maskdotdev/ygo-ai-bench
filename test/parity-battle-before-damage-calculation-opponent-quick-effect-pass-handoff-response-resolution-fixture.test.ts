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

describe("EDOPro parity before-damage-calculation opponent quick-effect pass handoff response resolution fixture", () => {
  it("resolves opponent before-damage-calculation pass-handoff chains after the turn player passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Opponent Before Damage Calculation Handoff Resolution Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Opponent Before Damage Calculation Handoff Resolution Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Opponent Before Damage Calculation Handoff Resolution Turn Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Opponent Before Damage Calculation Handoff Resolution Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "before damage calculation opponent quick pass handoff response resolution fixture",
      options: { seed: 413, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["300", "500"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-before-damage-calculation-handoff-resolution-open-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "open",
            logMessage: "Fixture opponent before-damage-calculation handoff resolution open quick resolved",
          },
          {
            id: "fixture-turn-before-damage-calculation-handoff-resolution-chain-quick",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture turn before-damage-calculation handoff resolution chain quick should not resolve",
          },
          {
            id: "fixture-opponent-before-damage-calculation-handoff-resolution-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture opponent before-damage-calculation handoff resolution chain quick resolved",
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
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-before-damage-calculation-handoff-resolution-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers opponent chain-only before-damage-calculation responses after the turn player passes the opponent's quick chain",
            waitingFor: 1,
            windowId: 8,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damage",
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-before-damage-calculation-handoff-resolution-open-quick", sourceUid: "p1-deck-300-0" }],
            chainPasses: [0],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-opponent-before-damage-calculation-handoff-resolution-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 8, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-before-damage-calculation-handoff-resolution-chain-quick", 1, 8),
              chainPassGroup(1, 1, 8),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 8, windowKind: "chainResponse", effectId: "fixture-opponent-before-damage-calculation-handoff-resolution-open-quick" },
              { type: "passDamage", player: 1, windowId: 8, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-before-damage-calculation-handoff-resolution-open-quick", 8, "chainResponse"),
              absentPassBattleGroup(1, "passDamage", 8),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-before-damage-calculation-handoff-resolution-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro reopens turn-player responses after the opponent chains from a before-damage-calculation pass handoff",
            waitingFor: 0,
            windowId: 9,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damage",
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [
              { player: 1, effectId: "fixture-opponent-before-damage-calculation-handoff-resolution-open-quick", sourceUid: "p1-deck-300-0" },
              { player: 1, effectId: "fixture-opponent-before-damage-calculation-handoff-resolution-chain-quick", sourceUid: "p1-deck-500-1" },
            ],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 9, windowKind: "chainResponse", effectId: "fixture-turn-before-damage-calculation-handoff-resolution-chain-quick", count: 1 },
              { type: "passChain", player: 0, windowId: 9, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(0, "fixture-turn-before-damage-calculation-handoff-resolution-chain-quick", 1, 9),
              chainPassGroup(0, 1, 9),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 9, windowKind: "chainResponse", effectId: "fixture-opponent-before-damage-calculation-handoff-resolution-open-quick" },
              { type: "activateEffect", player: 1, windowId: 9, windowKind: "chainResponse", effectId: "fixture-opponent-before-damage-calculation-handoff-resolution-chain-quick" },
              { type: "passDamage", player: 0, windowId: 9, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-before-damage-calculation-handoff-resolution-open-quick", 9, "chainResponse"),
              absentWindowEffectGroup(1, "fixture-opponent-before-damage-calculation-handoff-resolution-chain-quick", 9, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 9),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves opponent before-damage-calculation pass-handoff chains after the turn player passes the reopened response window",
        waitingFor: 1,
        windowId: 10,
        windowKind: "battle",
        pendingBattle: true,
        battleStep: "damage",
        battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 10, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 10)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 10, windowKind: "battle", effectId: "fixture-turn-before-damage-calculation-handoff-resolution-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 10, windowKind: "battle", effectId: "fixture-opponent-before-damage-calculation-handoff-resolution-open-quick" },
          { type: "activateEffect", player: 1, windowId: 10, windowKind: "battle", effectId: "fixture-opponent-before-damage-calculation-handoff-resolution-chain-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-turn-before-damage-calculation-handoff-resolution-chain-quick", 10, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-before-damage-calculation-handoff-resolution-open-quick", 10, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-before-damage-calculation-handoff-resolution-chain-quick", 10, "battle"),
        ],
        logIncludes: [
          "Fixture opponent before-damage-calculation handoff resolution chain quick resolved",
          "Fixture opponent before-damage-calculation handoff resolution open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
