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

describe("EDOPro parity opponent damage-calculation handoff response turn response chain-pass resolution fixture", () => {
  it("resolves damage-calculation handoff chains after the opponent passes the turn-response window", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Damage Calculation Chain Pass Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Damage Calculation Chain Pass Opponent Open Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Damage Calculation Chain Pass Turn Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Damage Calculation Chain Pass Opponent First Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "600", name: "Damage Calculation Chain Pass Opponent Second Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent damage calculation quick pass handoff response turn response chain pass resolution fixture",
      options: { seed: 423, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["300", "500", "600"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-damage-calculation-chain-pass-open-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            activationChain: "open",
            logMessage: "Fixture opponent damage-calculation chain pass open quick resolved",
          },
          {
            id: "fixture-turn-damage-calculation-chain-pass-chain-quick",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            activationChain: "chain",
            logMessage: "Fixture turn damage-calculation chain pass chain quick resolved",
          },
          {
            id: "fixture-opponent-damage-calculation-chain-pass-first-chain-quick",
            player: 1,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            activationChain: "chain",
            logMessage: "Fixture opponent damage-calculation chain pass first chain quick resolved",
          },
          {
            id: "fixture-opponent-damage-calculation-chain-pass-second-chain-quick",
            player: 1,
            code: "600",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            activationChain: "chain",
            logMessage: "Fixture opponent damage-calculation chain pass second chain quick should not resolve",
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
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-calculation-chain-pass-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers opponent chain-only damage-calculation responses after the turn player passes the opponent's quick chain",
            waitingFor: 1,
            windowId: 10,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-damage-calculation-chain-pass-open-quick", sourceUid: "p1-deck-300-0" }],
            chainPasses: [0],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 3 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 10, windowKind: "chainResponse", effectId: "fixture-opponent-damage-calculation-chain-pass-first-chain-quick", count: 1 },
              { type: "activateEffect", player: 1, windowId: 10, windowKind: "chainResponse", effectId: "fixture-opponent-damage-calculation-chain-pass-second-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 10, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 10,
                windowKind: "chainResponse",
                count: 1,
                actions: [
                  { type: "activateEffect", player: 1, windowId: 10, windowKind: "chainResponse", effectId: "fixture-opponent-damage-calculation-chain-pass-first-chain-quick", count: 1 },
                  { type: "activateEffect", player: 1, windowId: 10, windowKind: "chainResponse", effectId: "fixture-opponent-damage-calculation-chain-pass-second-chain-quick", count: 1 },
                ],
              },
              chainPassGroup(1, 1, 10),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 10, windowKind: "chainResponse", effectId: "fixture-opponent-damage-calculation-chain-pass-open-quick" },
              { type: "passDamage", player: 1, windowId: 10, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-chain-pass-open-quick", 10, "chainResponse"),
              absentPassBattleGroup(1, "passDamage", 10),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-calculation-chain-pass-first-chain-quick" })),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-damage-calculation-chain-pass-chain-quick" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro reopens opponent responses after the turn player answers a damage-calculation handoff chain",
            waitingFor: 1,
            windowId: 12,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [
              { player: 1, effectId: "fixture-opponent-damage-calculation-chain-pass-open-quick", sourceUid: "p1-deck-300-0" },
              { player: 1, effectId: "fixture-opponent-damage-calculation-chain-pass-first-chain-quick", sourceUid: "p1-deck-500-1" },
              { player: 0, effectId: "fixture-turn-damage-calculation-chain-pass-chain-quick", sourceUid: "p0-deck-400-1" },
            ],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 12, windowKind: "chainResponse", effectId: "fixture-opponent-damage-calculation-chain-pass-second-chain-quick", count: 1 },
              { type: "passChain", player: 1, windowId: 12, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [
              chainEffectGroup(1, "fixture-opponent-damage-calculation-chain-pass-second-chain-quick", 1, 12),
              chainPassGroup(1, 1, 12),
            ],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 12, windowKind: "chainResponse", effectId: "fixture-turn-damage-calculation-chain-pass-chain-quick" },
              { type: "activateEffect", player: 1, windowId: 12, windowKind: "chainResponse", effectId: "fixture-opponent-damage-calculation-chain-pass-open-quick" },
              { type: "activateEffect", player: 1, windowId: 12, windowKind: "chainResponse", effectId: "fixture-opponent-damage-calculation-chain-pass-first-chain-quick" },
              { type: "passDamage", player: 1, windowId: 12, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-turn-damage-calculation-chain-pass-chain-quick", 12, "chainResponse"),
              absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-chain-pass-open-quick", 12, "chainResponse"),
              absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-chain-pass-first-chain-quick", 12, "chainResponse"),
              absentPassBattleGroup(1, "passDamage", 12),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves damage-calculation handoff chains after the opponent passes the response window reopened by the turn player's answer",
        waitingFor: 1,
        windowId: 13,
        windowKind: "battle",
        pendingBattle: true,
        battleStep: "damageCalculation",
        battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 13, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 13)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 13, windowKind: "battle", effectId: "fixture-turn-damage-calculation-chain-pass-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 13, windowKind: "battle", effectId: "fixture-opponent-damage-calculation-chain-pass-open-quick" },
          { type: "activateEffect", player: 1, windowId: 13, windowKind: "battle", effectId: "fixture-opponent-damage-calculation-chain-pass-first-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 13, windowKind: "battle", effectId: "fixture-opponent-damage-calculation-chain-pass-second-chain-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-turn-damage-calculation-chain-pass-chain-quick", 13, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-chain-pass-open-quick", 13, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-chain-pass-first-chain-quick", 13, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-chain-pass-second-chain-quick", 13, "battle"),
        ],
        logIncludes: [
          "Fixture turn damage-calculation chain pass chain quick resolved",
          "Fixture opponent damage-calculation chain pass first chain quick resolved",
          "Fixture opponent damage-calculation chain pass open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
