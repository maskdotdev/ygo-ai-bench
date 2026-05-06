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

describe("EDOPro parity before-damage-calculation quick-effect pass handoff turn response resolution fixture", () => {
  it("resolves turn-player before-damage-calculation pass-handoff chains after the opponent passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Before Damage Calculation Handoff Resolution Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Before Damage Calculation Handoff Resolution Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Before Damage Calculation Handoff Resolution Opponent Chain Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "500", name: "Before Damage Calculation Handoff Resolution Turn Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "before damage calculation quick pass handoff turn response resolution fixture",
      options: { seed: 410, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "300", "500"] },
        1: { main: ["400", "400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-before-damage-calculation-handoff-resolution-open-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "open",
            logMessage: "Fixture before-damage-calculation handoff resolution open quick resolved",
          },
          {
            id: "fixture-opponent-before-damage-calculation-handoff-resolution-chain-quick",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture opponent before-damage-calculation handoff resolution chain quick should not resolve",
          },
          {
            id: "fixture-turn-before-damage-calculation-handoff-resolution-chain-quick",
            player: 0,
            code: "500",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture turn before-damage-calculation handoff resolution chain quick resolved",
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
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-before-damage-calculation-handoff-resolution-open-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro offers turn-player chain-only before-damage-calculation responses after the opponent passes the quick chain",
            waitingFor: 0,
            windowId: 9,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damage",
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-before-damage-calculation-handoff-resolution-open-quick", sourceUid: "p0-deck-300-1" }],
            chainPasses: [1],
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
              { type: "activateEffect", player: 0, windowId: 9, windowKind: "chainResponse", effectId: "fixture-before-damage-calculation-handoff-resolution-open-quick" },
              { type: "passDamage", player: 0, windowId: 9, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-before-damage-calculation-handoff-resolution-open-quick", 9, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 9),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-before-damage-calculation-handoff-resolution-chain-quick" })),
        makeScriptedStep(makeResponseSelector("passChain", 1), {
          snapshotRestore: "both",
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro resolves turn-player before-damage-calculation pass-handoff chains after the opponent passes the reopened response window",
        waitingFor: 1,
        windowId: 11,
        windowKind: "battle",
        pendingBattle: true,
        battleStep: "damage",
        battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 11, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 11)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 11, windowKind: "battle", effectId: "fixture-before-damage-calculation-handoff-resolution-open-quick" },
          { type: "activateEffect", player: 0, windowId: 11, windowKind: "battle", effectId: "fixture-turn-before-damage-calculation-handoff-resolution-chain-quick" },
          { type: "activateEffect", player: 1, windowId: 11, windowKind: "battle", effectId: "fixture-opponent-before-damage-calculation-handoff-resolution-chain-quick" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-before-damage-calculation-handoff-resolution-open-quick", 11, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-before-damage-calculation-handoff-resolution-chain-quick", 11, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-before-damage-calculation-handoff-resolution-chain-quick", 11, "battle"),
        ],
        logIncludes: [
          "Fixture turn before-damage-calculation handoff resolution chain quick resolved",
          "Fixture before-damage-calculation handoff resolution open quick resolved",
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
