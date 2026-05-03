import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, absentEffectGroup, passDamageGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity unflagged damage-step quick-effect fixtures", () => {
  it("does not offer unflagged quick effects during damage-step battle windows", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Unflagged Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "unflagged damage-step quick effect gate fixture",
      options: { seed: 76, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-unflagged-quick",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            logMessage: "Fixture unflagged quick resolved",
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
            note: "EDOPro does not expose ordinary unflagged quick effects once the Damage Step starts",
            waitingFor: 0,
            windowKind: "battle",
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-unflagged-quick" }],
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-unflagged-quick" }] }],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro keeps unflagged quick effects unavailable before damage calculation",
            waitingFor: 0,
            windowKind: "battle",
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-unflagged-quick" }],
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-unflagged-quick" }] }],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro also keeps unflagged quick effects unavailable during damage calculation",
            waitingFor: 0,
            windowKind: "battle",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-unflagged-quick" }],
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-unflagged-quick" }] }],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro keeps unflagged quick effects unavailable after damage calculation",
            waitingFor: 0,
            windowKind: "battle",
            battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-unflagged-quick" }],
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-unflagged-quick" }] }],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          after: {
            source: "edopro",
            note: "EDOPro keeps unflagged quick effects unavailable at end damage step",
            waitingFor: 0,
            windowKind: "battle",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            absentLegalActions: [{ type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-unflagged-quick" }],
            absentLegalActionGroups: [{ player: 0, label: "Effects", actions: [{ type: "activateEffect", player: 0, windowKind: "battle", effectId: "fixture-unflagged-quick" }] }],
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(0)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro resolves battle normally after players pass every damage-step window",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 1: 6200 },
            battleDamage: { 1: 1800 },
            attacksDeclared: ["p0-deck-100-0"],
            absentLegalActions: [
              { type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
            ],
            absentLegalActionGroups: [absentEffectGroup(0, "fixture-unflagged-quick"), absentAttackGroup("p0-deck-100-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state never exposed the unflagged quick effect during damage-step timing",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 1: 6200 },
        battleDamage: { 1: 1800 },
        attacksDeclared: ["p0-deck-100-0"],
        absentLegalActions: [
          { type: "activateEffect", player: 0, effectId: "fixture-unflagged-quick" },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
        ],
        absentLegalActionGroups: [absentEffectGroup(0, "fixture-unflagged-quick"), absentAttackGroup("p0-deck-100-0")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
