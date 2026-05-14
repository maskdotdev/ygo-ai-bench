import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, effectGroup, passDamageGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity damage-step-only quick-effect timing fixtures", () => {
  it("does not offer damage-step-only quick effects during damage calculation", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Damage Step Only Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "damage step quick excluded from damage calculation fixture",
      options: { seed: 79, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-damage-step-only-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x4000,
            logMessage: "Fixture damage-step-only quick resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro exposes damage-step fast effects before damage calculation",
            windowId: 5,
            windowKind: "battle",
            waitingFor: 0,
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 5, windowKind: "battle", effectId: "fixture-damage-step-only-quick", count: 1 },
              { type: "passDamage", player: 0, windowId: 5, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(0, "fixture-damage-step-only-quick", 1, 5), passDamageGroup(0, 1, 5)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps during-damage-calculation opponent priority restorable without exposing damage-step-only quick effects",
            phase: "battle",
            windowId: 8,
            windowKind: "battle",
            waitingFor: 1,
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowId: 8, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(1, 1, 8)],
          },
          after: {
            source: "edopro",
            note: "EDOPro does not expose regular damage-step fast effects during damage calculation",
            windowId: 9,
            windowKind: "battle",
            waitingFor: 0,
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, windowId: 9, windowKind: "battle", effectId: "fixture-damage-step-only-quick" }],
            absentLegalActionGroups: [
              { player: 0, label: "Effects", windowId: 9, windowKind: "battle", actions: [{ type: "activateEffect", player: 0, windowId: 9, windowKind: "battle", effectId: "fixture-damage-step-only-quick" }] },
            ],
            legalActions: [{ type: "passDamage", player: 0, windowId: 9, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0, 1, 9)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro exposes damage-step fast effects again after damage calculation",
            windowId: 11,
            windowKind: "battle",
            waitingFor: 0,
            battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 11, windowKind: "battle", effectId: "fixture-damage-step-only-quick", count: 1 },
              { type: "passDamage", player: 0, windowId: 11, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(0, "fixture-damage-step-only-quick", 1, 11), passDamageGroup(0, 1, 11)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the final end-damage-step turn-player pass restorable while damage-step-only quick effects are legal again",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: true,
            currentAttack: true,
            windowId: 13,
            windowKind: "battle",
            battleStep: "damage",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "activateEffect", player: 0, windowId: 13, windowKind: "battle", effectId: "fixture-damage-step-only-quick", count: 1 },
              { type: "passDamage", player: 0, windowId: 13, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(0, "fixture-damage-step-only-quick", 1, 13), passDamageGroup(0, 1, 13)],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves battle normally after the damage-step-only effect timing gates are passed",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            windowId: 14,
            battleWindow: null,
            lifePoints: { 1: 6200 },
            battleDamage: { 1: 1800 },
            attacksDeclared: ["p0-deck-100-0"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(14)],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, undefined, 14)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps damage-step-only quick effects out of damage calculation timing",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        windowId: 14,
        battleWindow: null,
        lifePoints: { 1: 6200 },
        battleDamage: { 1: 1800 },
        attacksDeclared: ["p0-deck-100-0"],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(14)],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, undefined, 14)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
