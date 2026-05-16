import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentOpenAttackGroup, attackGroup, passBattleGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity destroyed attacker replacement conflict fixtures", () => {
  it("prioritizes turn-player destroy replacement when the weaker attacker is battle-destroyed", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Replacement Conflict Weaker Attacker", kind: "monster", attack: 1200, defense: 1200 },
      { code: "200", name: "Replacement Conflict Stronger Target", kind: "monster", attack: 2000, defense: 1000 },
      { code: "300", name: "Earlier Opponent Replacement Source", kind: "monster", attack: 500, defense: 500 },
      { code: "301", name: "Earlier Opponent Replacement Cost", kind: "monster", attack: 500, defense: 500 },
      { code: "400", name: "Later Turn Replacement Source", kind: "monster", attack: 500, defense: 500 },
      { code: "401", name: "Later Turn Replacement Cost", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "destroyed attacker replacement conflict fixture",
      options: { seed: 244, startingHandSize: 3 },
      decks: {
        0: { main: ["100", "400", "401"] },
        1: { main: ["200", "300", "301"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "400", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "300", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-earlier-opponent-destroyed-attacker-replacement",
            player: 1,
            code: "300",
            location: "monsterZone",
            event: "continuous",
            effectCode: 50,
            luaTypeFlags: 0x2,
            property: 0x800,
            targetRange: [0, 1],
            targetCardsOnActivation: [{ player: 1, code: "301", location: "hand" }],
            moveCardsOnResolve: [{ player: 1, code: "301", from: "hand", to: "graveyard", moveReason: 0x1000040, moveReasonPlayer: 1 }],
            range: ["monsterZone"],
          },
          {
            id: "fixture-later-turn-destroyed-attacker-replacement",
            player: 0,
            code: "400",
            location: "monsterZone",
            event: "continuous",
            effectCode: 50,
            luaTypeFlags: 0x2,
            property: 0x800,
            targetRange: [1, 0],
            targetCardsOnActivation: [{ player: 0, code: "401", location: "hand" }],
            moveCardsOnResolve: [{ player: 0, code: "401", from: "hand", to: "graveyard", moveReason: 0x1000040, moveReasonPlayer: 0 }],
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }), {
          after: {
            source: "edopro",
            note: "EDOPro opens the attack-response window before resolving destroyed-attacker replacement conflicts",
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
            note: "EDOPro keeps the weaker attacker and replacement costs in place before final end-damage-step cleanup",
            phase: "battle",
            waitingFor: 0,
            windowId: 13,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleStep: "damage",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 0 },
            damagePasses: [1],
            locations: { monsterZone: ["100", "200", "300", "400"], hand: ["301", "401"] },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowId: 13, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage", 1, 13)],
          },
          after: {
            source: "edopro",
            note: "EDOPro applies the turn player's destroyed-attacker replacement before the earlier opponent replacement",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 0: 7200, 1: 8000 },
            battleDamage: { 0: 800, 1: 0 },
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
            locations: { monsterZone: ["100", "200", "300", "400"], graveyard: ["401"], hand: ["301"] },
            cards: [
              { uid: "p0-deck-100-0", location: "monsterZone" },
              { uid: "p0-deck-401-2", location: "graveyard", reason: 0x1000040, reasonPlayer: 0 },
              { uid: "p1-deck-301-2", location: "hand" },
            ],
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-400-1", targetUid: "p1-deck-200-0", windowId: 14, windowKind: "open", count: 1 },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-400-1", targetUid: "p1-deck-300-1", windowId: 14, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              attackGroup(
                [
                  { attackerUid: "p0-deck-400-1", targetUid: "p1-deck-200-0" },
                  { attackerUid: "p0-deck-400-1", targetUid: "p1-deck-300-1" },
                ],
                1,
                14,
              ),
              turnGroup(14),
            ],
            logIncludes: ["Destruction replaced"],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
            absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0", 14)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves turn-player priority for destroyed-attacker replacement conflicts",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 0: 7200, 1: 8000 },
        battleDamage: { 0: 800, 1: 0 },
        attacksDeclared: ["p0-deck-100-0"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
        locations: { monsterZone: ["100", "200", "300", "400"], graveyard: ["401"], hand: ["301"] },
        cards: [
          { uid: "p0-deck-100-0", location: "monsterZone" },
          { uid: "p0-deck-401-2", location: "graveyard", reason: 0x1000040, reasonPlayer: 0 },
          { uid: "p1-deck-301-2", location: "hand" },
        ],
        legalActionCounts: { 0: 4, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-400-1", targetUid: "p1-deck-200-0", windowId: 14, windowKind: "open", count: 1 },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-400-1", targetUid: "p1-deck-300-1", windowId: 14, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          attackGroup(
            [
              { attackerUid: "p0-deck-400-1", targetUid: "p1-deck-200-0" },
              { attackerUid: "p0-deck-400-1", targetUid: "p1-deck-300-1" },
            ],
            1,
            14,
          ),
          turnGroup(14),
        ],
        logIncludes: ["Destruction replaced"],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 14, windowKind: "open" }],
        absentLegalActionGroups: [absentOpenAttackGroup(0, "p0-deck-100-0", 14)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
