import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentWindowEffectGroup, chainEffectGroup, chainPassGroup, passDamageGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity opponent battle damage-calculation quick-effect chained return fixture", () => {
  it("resolves chained opponent damage-calculation quick effects back to damage-calculation timing", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Opponent Damage Calculation Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Turn Damage Calculation Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent damage calculation chained quick return fixture",
      options: { seed: 87, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-damage-calculation-open-quick-chain",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            activationChain: "open",
            logMessage: "Fixture opponent damage-calculation open quick chain resolved",
          },
          {
            id: "fixture-turn-damage-calculation-chain-quick-chain",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            activationChain: "chain",
            logMessage: "Fixture turn damage-calculation chain quick chain resolved",
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
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-calculation-open-quick-chain" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro gives the turn player chain-response priority after the opponent starts a damage-calculation quick chain",
            waitingFor: 0,
            windowId: 9,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-damage-calculation-open-quick-chain", sourceUid: "p1-deck-300-1" }],
            chainPasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 9, windowKind: "chainResponse", effectId: "fixture-turn-damage-calculation-chain-quick-chain", count: 1 },
              { type: "passChain", player: 0, windowId: 9, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "fixture-turn-damage-calculation-chain-quick-chain", 1, 9), chainPassGroup(0, 1, 9)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-damage-calculation-chain-quick-chain" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro resolves chained opponent damage-calculation quick effects and resumes damage calculation timing",
            waitingFor: 1,
            windowId: 10,
            windowKind: "battle",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowId: 10, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(1, 1, 10)],
            absentLegalActions: [
              { type: "activateEffect", player: 0, windowId: 10, windowKind: "battle", effectId: "fixture-turn-damage-calculation-chain-quick-chain" },
              { type: "activateEffect", player: 1, windowId: 10, windowKind: "battle", effectId: "fixture-opponent-damage-calculation-open-quick-chain" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(0, "fixture-turn-damage-calculation-chain-quick-chain", 10, "battle"),
              absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-open-quick-chain", 10, "battle"),
            ],
            logIncludes: ["Fixture turn damage-calculation chain quick chain resolved", "Fixture opponent damage-calculation open quick chain resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps damage calculation timing after chained opponent damage-calculation quick effects resolve",
        waitingFor: 1,
        windowId: 10,
        windowKind: "battle",
        pendingBattle: true,
        battleStep: "damageCalculation",
        battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 10, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 10)],
        absentLegalActions: [
          { type: "activateEffect", player: 0, windowId: 10, windowKind: "battle", effectId: "fixture-turn-damage-calculation-chain-quick-chain" },
          { type: "activateEffect", player: 1, windowId: 10, windowKind: "battle", effectId: "fixture-opponent-damage-calculation-open-quick-chain" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(0, "fixture-turn-damage-calculation-chain-quick-chain", 10, "battle"),
          absentWindowEffectGroup(1, "fixture-opponent-damage-calculation-open-quick-chain", 10, "battle"),
        ],
        logIncludes: ["Fixture turn damage-calculation chain quick chain resolved", "Fixture opponent damage-calculation open quick chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
