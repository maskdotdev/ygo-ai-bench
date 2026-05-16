import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, directAttackGroup, effectGroup, passBattleGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle opponent negation fixtures", () => {
  it("lets the non-turn player negate from the first attack-response window", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Negated Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Opponent Negator", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "opponent attack response negation fixture",
      options: { seed: 73, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-opponent-attack-negator",
            player: 1,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            negateAttackOnResolve: true,
            logMessage: "Fixture opponent attack negator resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps Battle Phase open priority restorable before the defender's attack-negation response opens",
            phase: "battle",
            waitingFor: 0,
            windowId: 1,
            windowKind: "open",
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            chain: [],
            chainPasses: [],
            attackPasses: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 1, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [directAttackGroup(0, "p0-deck-100-0", 1, 1), turnGroup(1)],
          },
          after: {
            source: "edopro",
            note: "EDOPro gives the non-turn player first chance to respond to an attack declaration",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-negator", count: 1 },
              { type: "passAttack", player: 1, windowId: 2, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Effects",
                windowId: 2,
                windowKind: "battle",
                count: 1,
                actions: [{ type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-negator", count: 1 }],
              },
              {
                player: 1,
                label: "Pass",
                windowId: 2,
                windowKind: "battle",
                count: 1,
                actions: [{ type: "passAttack", player: 1, windowId: 2, windowKind: "battle", count: 1 }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-attack-negator" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the defender's attack-negation response window restorable before the attack is negated",
            waitingFor: 1,
            windowId: 2,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 2 },
            legalActions: [
              { type: "activateEffect", player: 1, windowId: 2, windowKind: "battle", effectId: "fixture-opponent-attack-negator", count: 1 },
              { type: "passAttack", player: 1, windowId: 2, windowKind: "battle", count: 1 },
            ],
            legalActionGroups: [effectGroup(1, "fixture-opponent-attack-negator", 1, 2), passBattleGroup(1, "passAttack", 1, 2)],
          },
          after: {
            source: "edopro",
            note: "EDOPro clears the attack immediately when the defending player's attack-negating response resolves",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            windowId: 3,
            windowKind: "open",
            battleWindow: null,
            lifePoints: { 0: 8000, 1: 8000 },
            attacksDeclared: ["p0-deck-100-0"],
            attackCanceledUids: ["p0-deck-100-0"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(3)],
            absentLegalActions: [
              { type: "passAttack", player: 1 },
              { type: "passDamage", player: 1 },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 3, windowKind: "open" },
            ],
            absentLegalActionGroups: [
              { player: 1, label: "Pass", windowId: 3, windowKind: "battle", actions: [{ type: "passAttack", player: 1, windowId: 3, windowKind: "battle" }] },
              { player: 1, label: "Pass", windowId: 3, windowKind: "battle", actions: [{ type: "passDamage", player: 1, windowId: 3, windowKind: "battle" }] },
              absentAttackGroup("p0-deck-100-0", undefined, undefined, 3),
            ],
            logIncludes: ["Negated attack true", "Fixture opponent attack negator resolved", "Negated attack"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the attack spent after the defending player negates it",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        windowId: 3,
        windowKind: "open",
        battleWindow: null,
        lifePoints: { 0: 8000, 1: 8000 },
        attacksDeclared: ["p0-deck-100-0"],
        attackCanceledUids: ["p0-deck-100-0"],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(3)],
        absentLegalActions: [
          { type: "passAttack", player: 1 },
          { type: "passDamage", player: 1 },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowId: 3, windowKind: "open" },
        ],
        absentLegalActionGroups: [
          { player: 1, label: "Pass", windowId: 3, windowKind: "battle", actions: [{ type: "passAttack", player: 1, windowId: 3, windowKind: "battle" }] },
          { player: 1, label: "Pass", windowId: 3, windowKind: "battle", actions: [{ type: "passDamage", player: 1, windowId: 3, windowKind: "battle" }] },
          absentAttackGroup("p0-deck-100-0", undefined, undefined, 3),
        ],
        logIncludes: ["Negated attack true", "Fixture opponent attack negator resolved", "Negated attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
