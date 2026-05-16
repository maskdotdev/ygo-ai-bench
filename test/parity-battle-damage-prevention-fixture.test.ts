import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentOpenAttackGroup, directAttackGroup, passBattleGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle damage prevention fixtures", () => {
  it("applies player-scoped battle damage prevention", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Prevented Damage Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Damage Shield", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "battle damage prevention fixture",
      options: { seed: 84, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-prevent-opponent-battle-damage",
            player: 0,
            code: "300",
            location: "monsterZone",
            event: "continuous",
            effectCode: 201,
            targetRange: [0, 1],
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro opens the direct-attack response window before battle damage prevention is applied",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
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
            note: "EDOPro keeps the final end-damage-step pass restorable before player-scoped battle damage prevention is applied",
            phase: "battle",
            waitingFor: 0,
            windowId: 13,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleStep: "damage",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            locations: { monsterZone: ["100", "300"] },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowId: 13, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage", 1, 13)],
          },
          after: {
            source: "edopro",
            note: "EDOPro applies player-scoped battle damage prevention before LP damage is dealt",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 0: 8000, 1: 8000 },
            battleDamage: { 0: 0, 1: 0 },
            attacksDeclared: ["p0-deck-100-0"],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-300-1", directAttack: true, windowId: 14, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [directAttackGroup(0, "p0-deck-300-1", 1, 14), turnGroup(14)],
            logIncludes: ["0", "Direct attack"],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
            absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0", 14)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves prevented direct battle damage",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 0: 8000, 1: 8000 },
        battleDamage: { 0: 0, 1: 0 },
        attacksDeclared: ["p0-deck-100-0"],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-300-1", directAttack: true, windowId: 14, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [directAttackGroup(0, "p0-deck-300-1", 1, 14), turnGroup(14)],
        logIncludes: ["0", "Direct attack"],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
        absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0", 14)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
