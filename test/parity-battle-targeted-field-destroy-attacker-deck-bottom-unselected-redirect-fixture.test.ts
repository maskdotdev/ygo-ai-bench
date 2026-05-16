import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentOpenAttackGroup, passBattleGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity targeted field battle destroy attacker deck-bottom unselected redirect fixtures", () => {
  it("does not apply targeted field battle destroy attacker deck-bottom redirects through unselected defending destroyers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Targeted Deck Bottom Redirect Weak Attacker", kind: "monster", attack: 1000, defense: 1000 },
      { code: "101", name: "Targeted Deck Bottom Existing Card", kind: "monster", attack: 500, defense: 500 },
      { code: "200", name: "Selected Deck Bottom Redirect Defender", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Targeted Deck Bottom Redirect Defender Source", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Unselected Deck Bottom Redirect Strong Defender", kind: "monster", attack: 1800, defense: 1200 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "targeted field battle destroy attacker deck bottom unselected redirect fixture",
      options: { seed: 209, startingHandSize: 0 },
      decks: {
        0: { main: ["101", "100"] },
        1: { main: ["200", "300", "400"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "deck", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "300", from: "deck", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "400", from: "deck", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-targeted-field-attacker-deck-bottom-unselected-battle-destroy-redirect",
            player: 1,
            code: "300",
            location: "monsterZone",
            event: "continuous",
            effectCode: 204,
            value: 0x10001,
            targetCardCode: "200",
            targetRange: [0x04, 0],
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-1", targetUid: "p1-deck-400-2" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro opens the attack-response window before unselected defending targeted deck-bottom redirects are tested",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-1", targetUid: "p1-deck-400-2", responsePlayer: 1 },
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
            note: "EDOPro keeps the attacker, targeted deck-bottom redirect source, unselected defender, and existing deck card in place before cleanup",
            phase: "battle",
            waitingFor: 0,
            windowId: 13,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleStep: "damage",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-1", targetUid: "p1-deck-400-2", responsePlayer: 0 },
            damagePasses: [1],
            locations: { monsterZone: ["100", "300", "400"], deck: ["101", "200"] },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowId: 13, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage", 1, 13)],
          },
          after: {
            source: "edopro",
            note: "EDOPro leaves attackers destroyed by unselected defending deck-bottom redirect destroyers in the graveyard instead of applying the field redirect",
            waitingFor: 0,
            windowId: 14,
            windowKind: "open",
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 0: 7200, 1: 8000 },
            battleDamage: { 0: 800, 1: 0 },
            attacksDeclared: ["p0-deck-100-1"],
            battlePairs: [{ attackerUid: "p0-deck-100-1", targetUid: "p1-deck-400-2" }],
            locations: { monsterZone: ["300", "400"], graveyard: ["100"], deck: ["101", "200"] },
            cards: [{ uid: "p0-deck-100-1", location: "graveyard", reason: 0x21, reasonPlayer: 1, reasonCardUid: "p1-deck-400-2" }],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(14)],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-1", windowId: 14, windowKind: "open" }],
            absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-1", 14)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves targeted field attacker deck-bottom battle destruction redirect filtering",
        phase: "battle",
        waitingFor: 0,
        windowId: 14,
        windowKind: "open",
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 0: 7200, 1: 8000 },
        battleDamage: { 0: 800, 1: 0 },
        attacksDeclared: ["p0-deck-100-1"],
        battlePairs: [{ attackerUid: "p0-deck-100-1", targetUid: "p1-deck-400-2" }],
        locations: { monsterZone: ["300", "400"], graveyard: ["100"], deck: ["101", "200"] },
        cards: [{ uid: "p0-deck-100-1", location: "graveyard", reason: 0x21, reasonPlayer: 1, reasonCardUid: "p1-deck-400-2" }],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(14)],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-1", windowId: 14, windowKind: "open" }],
        absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-1", 14)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
