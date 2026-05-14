import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentOpenAttackGroup, passBattleGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity equal defense-position battle result fixtures", () => {
  it("keeps both monsters when ATK equals DEF in defense-position battle", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Equal Defense Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Equal Defense Target", kind: "monster", attack: 500, defense: 1800 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "equal attack defense battle fixture",
      options: { seed: 94, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpDefense" },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }), {
          after: {
            source: "edopro",
            note: "EDOPro opens the attack-response window before resolving equal ATK versus DEF battle",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passAttack", player: 1, windowId: 2, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passAttack", 1, 2)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the final equal-DEF damage-step pass restorable before closing the battle",
            phase: "battle",
            windowId: 13,
            windowKind: "battle",
            waitingFor: 0,
            pendingBattle: true,
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 0 },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowId: 13, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage", 1, 13)],
          },
          after: {
            source: "edopro",
            note: "EDOPro applies no damage and destroys neither monster when ATK equals a defense-position target's DEF",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 0: 8000, 1: 8000 },
            battleDamage: { 0: 0, 1: 0 },
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
            locations: { monsterZone: ["100", "200"] },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(14)],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
            absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0", 14)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves no destruction and no damage for equal ATK versus DEF battle",
        phase: "battle",
        windowId: 14,
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 0: 8000, 1: 8000 },
        battleDamage: { 0: 0, 1: 0 },
        attacksDeclared: ["p0-deck-100-0"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
        locations: { monsterZone: ["100", "200"] },
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(14)],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
        absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0", 14)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
