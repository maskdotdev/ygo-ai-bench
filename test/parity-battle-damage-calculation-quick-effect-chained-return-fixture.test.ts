import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentPassBattleGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup, effectGroup, passDamageGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle damage-calculation quick-effect chained return fixture", () => {
  it("resolves chained damage-calculation quick effects back to damage-calculation timing", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Damage Calculation Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Opponent Damage Calculation Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "damage calculation chained quick return fixture",
      options: { seed: 86, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["400", "400"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-damage-calculation-open-quick-chain",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            activationChain: "open",
            logMessage: "Fixture damage-calculation open quick chain resolved",
          },
          {
            id: "fixture-opponent-damage-calculation-chain-quick-chain",
            player: 1,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            activationChain: "chain",
            logMessage: "Fixture opponent damage-calculation chain quick chain resolved",
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
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-damage-calculation-open-quick-chain" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the turn-player damage-calculation quick-effect window restorable before the chain starts",
            waitingFor: 0,
            windowId: 9,
            windowKind: "battle",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [],
            chainPasses: [],
            damagePasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 9, windowKind: "battle", effectId: "fixture-damage-calculation-open-quick-chain", count: 1 },
              { type: "passDamage", player: 0, windowId: 9, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(0, "fixture-damage-calculation-open-quick-chain", 1, 9), passDamageGroup(0, 1, 9)],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 9, windowKind: "battle", effectId: "fixture-opponent-damage-calculation-chain-quick-chain" },
              { type: "passDamage", player: 1, windowId: 9, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-chain-quick-chain", 9, "battle"),
              absentPassBattleGroup(1, "passDamage", 9),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro gives the opponent a chain-response window after a damage-calculation quick effect starts a chain",
            waitingFor: 1,
            windowId: 10,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-damage-calculation-open-quick-chain", sourceUid: "p0-deck-300-1" }],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 10, windowKind: "chainResponse", effectId: "fixture-opponent-damage-calculation-chain-quick-chain", count: 1 },
              { type: "passChain", player: 1, windowId: 10, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "fixture-opponent-damage-calculation-chain-quick-chain", 1, 10), chainPassGroup(1, 1, 10)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-calculation-chain-quick-chain" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the opponent damage-calculation chain-response window restorable before the chained quick effect resolves",
            waitingFor: 1,
            windowId: 10,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            chain: [{ player: 0, effectId: "fixture-damage-calculation-open-quick-chain", sourceUid: "p0-deck-300-1" }],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 10, windowKind: "chainResponse", effectId: "fixture-opponent-damage-calculation-chain-quick-chain", count: 1 },
              { type: "passChain", player: 1, windowId: 10, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(1, "fixture-opponent-damage-calculation-chain-quick-chain", 1, 10), chainPassGroup(1, 1, 10)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 10, windowKind: "chainResponse", effectId: "fixture-damage-calculation-open-quick-chain" },
              { type: "passDamage", player: 1, windowId: 10, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-damage-calculation-open-quick-chain", 10, "chainResponse"),
              absentPassBattleGroup(1, "passDamage", 10),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves chained damage-calculation quick effects and resumes damage calculation timing",
            waitingFor: 1,
            windowId: 11,
            windowKind: "battle",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowId: 11, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(1, 1, 11)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 11, windowKind: "battle", effectId: "fixture-damage-calculation-open-quick-chain" },
              { type: "activateEffect", player: 1, windowId: 11, windowKind: "battle", effectId: "fixture-opponent-damage-calculation-chain-quick-chain" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-damage-calculation-open-quick-chain", 11, "battle"),
              absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-chain-quick-chain", 11, "battle"),
            ],
            logIncludes: ["Fixture opponent damage-calculation chain quick chain resolved", "Fixture damage-calculation open quick chain resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps damage calculation timing after chained damage-calculation quick effects resolve",
        waitingFor: 1,
        windowId: 11,
        windowKind: "battle",
        pendingBattle: true,
        battleStep: "damageCalculation",
        battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 11, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 11)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 11, windowKind: "battle", effectId: "fixture-damage-calculation-open-quick-chain" },
          { type: "activateEffect", player: 1, windowId: 11, windowKind: "battle", effectId: "fixture-opponent-damage-calculation-chain-quick-chain" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-damage-calculation-open-quick-chain", 11, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-chain-quick-chain", 11, "battle"),
        ],
        logIncludes: ["Fixture opponent damage-calculation chain quick chain resolved", "Fixture damage-calculation open quick chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
