import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentOpenAttackGroup, directAttackGroup, passBattleGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity targeted field battle destroy extra deck redirect fixtures", () => {
  it("applies targeted field battle destroy redirects to extra deck through selected destroyers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Selected Extra Deck Redirect Destroyer", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Targeted Extra Deck Redirect Victim", kind: "monster", attack: 1000, defense: 1000, typeFlags: 0x41 },
      { code: "300", name: "Targeted Extra Deck Redirect Source", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "targeted field battle destroy extra deck redirect fixture",
      options: { seed: 195, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: [], extra: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "300", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "extraDeck", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-targeted-field-extra-deck-battle-destroy-redirect",
            player: 0,
            code: "300",
            location: "monsterZone",
            event: "continuous",
            effectCode: 204,
            value: 0x40,
            targetCardCode: "100",
            targetRange: [0x04, 0],
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-extraDeck-200-0" }), {
          after: {
            source: "edopro",
            note: "EDOPro opens the attack-response window before selected targeted extra deck battle-destroy redirects are tested",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-extraDeck-200-0", responsePlayer: 1 },
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
            note: "EDOPro keeps the targeted redirect source, selected destroyer, and extra deck target on field before final cleanup",
            phase: "battle",
            waitingFor: 0,
            windowId: 13,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleStep: "damage",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", targetUid: "p1-extraDeck-200-0", responsePlayer: 0 },
            damagePasses: [1],
            locations: { monsterZone: ["100", "200", "300"] },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowId: 13, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage", 1, 13)],
          },
          after: {
            source: "edopro",
            note: "EDOPro applies targeted field battle-destroy redirects to extra deck when the selected destroyer wins the battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 0: 8000, 1: 7200 },
            battleDamage: { 0: 0, 1: 800 },
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-extraDeck-200-0" }],
            locations: { monsterZone: ["100", "300"], extraDeck: ["200"] },
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-300-1", directAttack: true, windowId: 14, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [directAttackGroup(0, "p0-deck-300-1", 1, 14), turnGroup(14)],
            logIncludes: ["Destroyed and moved to extraDeck"],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
            absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0", 14)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves selected targeted field battle destruction redirect to extra deck",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 0: 8000, 1: 7200 },
        battleDamage: { 0: 0, 1: 800 },
        attacksDeclared: ["p0-deck-100-0"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-extraDeck-200-0" }],
        locations: { monsterZone: ["100", "300"], extraDeck: ["200"] },
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-300-1", directAttack: true, windowId: 14, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [directAttackGroup(0, "p0-deck-300-1", 1, 14), turnGroup(14)],
        logIncludes: ["Destroyed and moved to extraDeck"],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
        absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0", 14)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
