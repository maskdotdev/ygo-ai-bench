import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity battle negation fixtures", () => {
  it("clears the battle window when a quick effect negates an attack", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Negated Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "300", name: "Attack Negator", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack response negation fixture",
      options: { seed: 72, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "300"] },
        1: { main: ["300", "300"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-attack-negator",
            player: 0,
            code: "300",
            location: "hand",
            event: "quick",
            range: ["hand"],
            oncePerTurn: true,
            negateAttackOnResolve: true,
            logMessage: "Fixture attack negator resolved",
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro opens the opponent's attack-response window after a direct attack declaration",
            waitingFor: 1,
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            attacksDeclared: ["p0-deck-100-0"],
            legalActions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 1), {
          after: {
            source: "edopro",
            note: "EDOPro passes attack-response priority to the turn player, who may activate attack-negating fast effects",
            waitingFor: 0,
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            legalActions: [{ type: "activateEffect", player: 0, effectId: "fixture-attack-negator", count: 1 }],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: "fixture-attack-negator" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro clears pending battle state after an attack is negated",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attackPasses: [],
            damagePasses: [],
            lifePoints: { 0: 8000, 1: 8000 },
            attacksDeclared: ["p0-deck-100-0"],
            attackCanceledUids: ["p0-deck-100-0"],
            absentLegalActions: [
              { type: "passAttack", player: 0 },
              { type: "passDamage", player: 0 },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
            ],
            logIncludes: ["Negated attack true", "Fixture attack negator resolved", "Negated attack"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the attack spent but cancels all active battle windows",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 0: 8000, 1: 8000 },
        attacksDeclared: ["p0-deck-100-0"],
        attackCanceledUids: ["p0-deck-100-0"],
        absentLegalActions: [
          { type: "passAttack", player: 0 },
          { type: "passDamage", player: 0 },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
        ],
        logIncludes: ["Negated attack true", "Fixture attack negator resolved", "Negated attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

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
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro gives the non-turn player first chance to respond to an attack declaration",
            waitingFor: 1,
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActions: [
              { type: "activateEffect", player: 1, effectId: "fixture-opponent-attack-negator", count: 1 },
              { type: "passAttack", player: 1, windowKind: "battle", count: 1 },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("activateEffect", 1, { effectId: "fixture-opponent-attack-negator" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro clears the attack immediately when the defending player's attack-negating response resolves",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 0: 8000, 1: 8000 },
            attacksDeclared: ["p0-deck-100-0"],
            attackCanceledUids: ["p0-deck-100-0"],
            absentLegalActions: [
              { type: "passAttack", player: 1 },
              { type: "passDamage", player: 1 },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
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
        battleWindow: null,
        lifePoints: { 0: 8000, 1: 8000 },
        attacksDeclared: ["p0-deck-100-0"],
        attackCanceledUids: ["p0-deck-100-0"],
        absentLegalActions: [
          { type: "passAttack", player: 1 },
          { type: "passDamage", player: 1 },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
        ],
        logIncludes: ["Negated attack true", "Fixture opponent attack negator resolved", "Negated attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
