import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentPassBattleGroup, absentWindowEffectGroup, chainEffectGroup, chainPassGroup, effectGroup, passDamageGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity opponent battle quick-effect chained return fixture", () => {
  it("resolves chained opponent damage-step quick effects back to damage-step timing", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Opponent Damage Step Quick", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Turn Damage Step Chain Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent damage step chained quick return fixture",
      options: { seed: 85, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "400"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-damage-step-open-quick-chain",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "open",
            logMessage: "Fixture opponent damage-step open quick chain resolved",
          },
          {
            id: "fixture-turn-damage-step-chain-quick-chain",
            player: 0,
            code: "400",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            activationChain: "chain",
            logMessage: "Fixture turn damage-step chain quick chain resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-step-open-quick-chain" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the opponent start-damage-step quick-effect window restorable before the chain starts",
            waitingFor: 1,
            windowId: 4,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 4, windowKind: "battle", effectId: "fixture-opponent-damage-step-open-quick-chain", count: 1 },
              { type: "passDamage", player: 1, windowId: 4, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(1, "fixture-opponent-damage-step-open-quick-chain", 1, 4), passDamageGroup(1, 1, 4)],
            absentLegalActions: [{ type: "passDamage", player: 0, windowId: 4, windowKind: "battle" }],
            absentLegalActionGroups: [absentPassBattleGroup(0, "passDamage", 4)],
          },
          after: {
            source: "edopro",
            note: "EDOPro gives the turn player a chain-response window after the opponent damage-step quick effect starts a chain",
            waitingFor: 0,
            windowId: 5,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-damage-step-open-quick-chain", sourceUid: "p1-deck-300-1" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-chain-quick-chain", count: 1 },
              { type: "passChain", player: 0, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "fixture-turn-damage-step-chain-quick-chain", 1, 5), chainPassGroup(0, 1, 5)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-turn-damage-step-chain-quick-chain" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the turn-player start-damage-step chain-response window restorable before the chained quick effect resolves",
            waitingFor: 0,
            windowId: 5,
            windowKind: "chainResponse",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [{ player: 1, effectId: "fixture-opponent-damage-step-open-quick-chain", sourceUid: "p1-deck-300-1" }],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "chainResponse", effectId: "fixture-turn-damage-step-chain-quick-chain", count: 1 },
              { type: "passChain", player: 0, windowId: 5, windowKind: "chainResponse", count: 1 },
            ],
            legalActionGroups: [chainEffectGroup(0, "fixture-turn-damage-step-chain-quick-chain", 1, 5), chainPassGroup(0, 1, 5)],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 5, windowKind: "chainResponse", effectId: "fixture-opponent-damage-step-open-quick-chain" },
              { type: "passDamage", player: 0, windowId: 5, windowKind: "battle" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-damage-step-open-quick-chain", 5, "chainResponse"),
              absentPassBattleGroup(0, "passDamage", 5),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves chained opponent damage-step quick effects and resumes start damage step timing",
            waitingFor: 1,
            windowId: 6,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            chain: [],
            chainPasses: [],
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowId: 6, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(1, 1, 6)],
            absentLegalActions: [
              { type: "activateEffect", player: 1, windowId: 6, windowKind: "battle", effectId: "fixture-opponent-damage-step-open-quick-chain" },
              { type: "activateEffect", player: 0, windowId: 6, windowKind: "battle", effectId: "fixture-turn-damage-step-chain-quick-chain" },
            ],
            absentLegalActionGroups: [
              absentWindowEffectGroup(1, "fixture-opponent-damage-step-open-quick-chain", 6, "battle"),
              absentWindowEffectGroup(0, "fixture-turn-damage-step-chain-quick-chain", 6, "battle"),
            ],
            logIncludes: ["Fixture turn damage-step chain quick chain resolved", "Fixture opponent damage-step open quick chain resolved"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro keeps start damage step timing after chained opponent damage-step quick effects resolve",
        waitingFor: 1,
        windowId: 6,
        windowKind: "battle",
        pendingBattle: true,
        battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        chain: [],
        chainPasses: [],
        damagePasses: [],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 6, windowKind: "battle", count: 1 }],
        legalActionGroups: [passDamageGroup(1, 1, 6)],
        absentLegalActions: [
          { type: "activateEffect", player: 1, windowId: 6, windowKind: "battle", effectId: "fixture-opponent-damage-step-open-quick-chain" },
          { type: "activateEffect", player: 0, windowId: 6, windowKind: "battle", effectId: "fixture-turn-damage-step-chain-quick-chain" },
        ],
        absentLegalActionGroups: [
          absentWindowEffectGroup(1, "fixture-opponent-damage-step-open-quick-chain", 6, "battle"),
          absentWindowEffectGroup(0, "fixture-turn-damage-step-chain-quick-chain", 6, "battle"),
        ],
        logIncludes: ["Fixture turn damage-step chain quick chain resolved", "Fixture opponent damage-step open quick chain resolved"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
