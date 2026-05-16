import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentOpenAttackGroup, passBattleGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle destroy deck-shuffle redirect fixtures", () => {
  it("applies destroyer-carried battle destroy redirects to shuffled deck", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Deck Shuffle Redirect Destroyer", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Deck Shuffle Redirect Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "201", name: "Deck Shuffle Existing Card A", kind: "monster", attack: 500, defense: 500 },
      { code: "202", name: "Deck Shuffle Existing Card B", kind: "monster", attack: 600, defense: 600 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "battle destroy deck shuffle redirect fixture",
      options: { seed: 172, startingHandSize: 0 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["201", "202", "200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "deck", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "deck", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-destroyer-battle-destroy-deck-shuffle-redirect",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 204,
            value: 0x20001,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2" }), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro opens the attack-response window before destroyer-carried battle-destroy deck-shuffle redirects can apply",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2", responsePlayer: 1 },
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
            note: "EDOPro keeps the redirect destroyer and battle target on field before final end-damage-step cleanup",
            phase: "battle",
            waitingFor: 0,
            windowId: 13,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleStep: "damage",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2", responsePlayer: 0 },
            damagePasses: [1],
            locations: { monsterZone: ["100", "200"], deck: ["201", "202"] },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowId: 13, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage", 1, 13)],
          },
          after: {
            source: "edopro",
            note: "EDOPro shuffles the battle-destroyed target into deck when redirected to LOCATION_DECKSHF",
            waitingFor: 0,
            windowId: 14,
            windowKind: "open",
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 0: 8000, 1: 7200 },
            battleDamage: { 0: 0, 1: 800 },
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2" }],
            locations: { monsterZone: ["100"], deck: ["200", "201", "202"] },
            cards: [
              { uid: "p1-deck-200-2", location: "deck", sequence: 0 },
              { uid: "p1-deck-202-1", location: "deck", sequence: 1 },
              { uid: "p1-deck-201-0", location: "deck", sequence: 2 },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(14)],
            logIncludes: ["Destroyed and moved to deck"],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
            absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0", 14)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves battle destruction redirect to shuffled deck",
        phase: "battle",
        waitingFor: 0,
        windowId: 14,
        windowKind: "open",
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 0: 8000, 1: 7200 },
        battleDamage: { 0: 0, 1: 800 },
        attacksDeclared: ["p0-deck-100-0"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-2" }],
        locations: { monsterZone: ["100"], deck: ["200", "201", "202"] },
        cards: [
          { uid: "p1-deck-200-2", location: "deck", sequence: 0 },
          { uid: "p1-deck-202-1", location: "deck", sequence: 1 },
          { uid: "p1-deck-201-0", location: "deck", sequence: 2 },
        ],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(14)],
        logIncludes: ["Destroyed and moved to deck"],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
        absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0", 14)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
