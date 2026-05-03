import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, effectGroup, passDamageGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity opponent battle damage-calculation quick-effect fixtures", () => {
  it("offers opponent damage-calculation quick effects during damage calculation", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Opponent Damage Calculation Quick", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent damage calculation quick effect fixture",
      options: { seed: 78, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-damage-calculation-quick",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            property: 0x8000,
            logMessage: "Fixture opponent damage-calculation quick resolved",
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
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro gives the non-turn player first response during damage calculation and exposes their damage-calculation fast effects",
            waitingFor: 1,
            windowKind: "battle",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, effectId: "fixture-opponent-damage-calculation-quick", count: 1 },
              { type: "passDamage", player: 1, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(1, "fixture-opponent-damage-calculation-quick"), passDamageGroup(1)],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-damage-calculation-quick" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro resumes damage calculation timing after the opponent's damage-calculation fast effect resolves",
            waitingFor: 1,
            windowKind: "battle",
            pendingBattle: true,
            battleStep: "damageCalculation",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passDamageGroup(1)],
            absentLegalActions: [{ type: "activateEffect", player: 1, windowKind: "battle", effectId: "fixture-opponent-damage-calculation-quick" }],
            absentLegalActionGroups: [
              { player: 1, label: "Effects", actions: [{ type: "activateEffect", player: 1, windowKind: "battle", effectId: "fixture-opponent-damage-calculation-quick" }] },
            ],
            logIncludes: ["Fixture opponent damage-calculation quick resolved"],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro resolves battle normally after the opponent's damage-calculation fast effect resolves",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            windowId: 15,
            battleWindow: null,
            lifePoints: { 1: 6200 },
            battleDamage: { 1: 1800 },
            attacksDeclared: ["p0-deck-100-0"],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 15, windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, undefined, 15)],
            logIncludes: ["Fixture opponent damage-calculation quick resolved", "Direct attack"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state applies direct damage after the opponent's damage-calculation fast effect resolves",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        windowId: 15,
        battleWindow: null,
        lifePoints: { 1: 6200 },
        battleDamage: { 1: 1800 },
        attacksDeclared: ["p0-deck-100-0"],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 15, windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, undefined, 15)],
        logIncludes: ["Fixture opponent damage-calculation quick resolved", "Direct attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
