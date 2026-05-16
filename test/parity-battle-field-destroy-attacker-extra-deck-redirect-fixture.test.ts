import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentOpenAttackGroup, passBattleGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity field battle destroy attacker extra deck redirect fixtures", () => {
  it("applies field-scoped battle destroy redirects to destroyed extra deck attackers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Extra Deck Redirect Weak Attacker", kind: "monster", attack: 1000, defense: 1000, typeFlags: 0x41 },
      { code: "200", name: "Field Extra Deck Redirect Strong Target", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Field Extra Deck Redirect Attacker Source", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "field battle destroy attacker extra deck redirect fixture",
      options: { seed: 190, startingHandSize: 2 },
      decks: {
        0: { main: [], extra: ["100"] },
        1: { main: ["200", "300"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "extraDeck", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "300", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-field-attacker-battle-destroy-extra-deck-redirect",
            player: 1,
            code: "300",
            location: "monsterZone",
            event: "continuous",
            effectCode: 204,
            value: 0x40,
            targetRange: [0, 1],
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-extraDeck-100-0", targetUid: "p1-deck-200-0" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro opens the attack-response window before field-scoped attacker extra deck battle-destroy redirects can apply",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-extraDeck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 1 },
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
            note: "EDOPro keeps the extra deck attacker, stronger target, and field redirect source on field before final end-damage-step cleanup",
            phase: "battle",
            waitingFor: 0,
            windowId: 13,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleStep: "damage",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-extraDeck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 0 },
            damagePasses: [1],
            locations: { monsterZone: ["100", "200", "300"] },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowId: 13, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage", 1, 13)],
          },
          after: {
            source: "edopro",
            note: "EDOPro lets non-battling field effects redirect an attacking extra deck monster destroyed by battle to extra deck",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 0: 7200, 1: 8000 },
            battleDamage: { 0: 800, 1: 0 },
            attacksDeclared: ["p0-extraDeck-100-0"],
            battlePairs: [{ attackerUid: "p0-extraDeck-100-0", targetUid: "p1-deck-200-0" }],
            locations: { monsterZone: ["200", "300"], extraDeck: ["100"] },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(14)],
            logIncludes: ["Destroyed and moved to extraDeck"],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-extraDeck-100-0", windowId: 14, windowKind: "open" }],
            absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-extraDeck-100-0", 14)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves field-scoped attacker battle destruction redirect to extra deck",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 0: 7200, 1: 8000 },
        battleDamage: { 0: 800, 1: 0 },
        attacksDeclared: ["p0-extraDeck-100-0"],
        battlePairs: [{ attackerUid: "p0-extraDeck-100-0", targetUid: "p1-deck-200-0" }],
        locations: { monsterZone: ["200", "300"], extraDeck: ["100"] },
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(14)],
        logIncludes: ["Destroyed and moved to extraDeck"],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-extraDeck-100-0", windowId: 14, windowKind: "open" }],
        absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-extraDeck-100-0", 14)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
