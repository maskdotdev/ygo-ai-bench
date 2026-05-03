import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { directAttackGroup, passBattleGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity end damage step fixtures", () => {
  it("advances from after damage calculation to end damage step after both players pass", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Opponent Card", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "after calculation to end damage step fixture",
      options: { seed: 64, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          after: {
            source: "edopro",
            note: "EDOPro opens after damage calculation before that timing's first response pass",
            waitingFor: 1,
            battleStep: "damage",
            windowKind: "battle",
            battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro passes after damage calculation priority back to the turn player after the opponent passes",
            waitingFor: 0,
            pendingBattle: true,
            battleStep: "damage",
            windowKind: "battle",
            battleWindow: { kind: "afterDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro advances to end damage step after both players pass after damage calculation responses",
            waitingFor: 1,
            pendingBattle: true,
            battleStep: "damage",
            windowKind: "battle",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            eventHistory: [
              { eventName: "phaseStartBattle" },
              { eventName: "phaseChanged" },
              { eventName: "phaseBattle" },
              { eventName: "attackDeclared", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleStarted", eventCode: 1132 },
              { eventName: "battleConfirmed", eventCode: 1133 },
              { eventName: "beforeDamageCalculation", eventCode: 1134 },
              { eventName: "afterDamageCalculation", eventCode: 1138 },
              { eventName: "damageStepEnded", eventCode: 1141 },
            ],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture window remains at end damage step waiting for the non-turn player's response",
        phase: "battle",
        waitingFor: 1,
        pendingBattle: true,
        battleStep: "damage",
        windowKind: "battle",
        battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passDamage")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("clears the battle window and applies direct battle damage after end damage step passes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Opponent Card", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "end damage step cleanup fixture",
      options: { seed: 65, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" })),
        makeScriptedStep(makeResponseSelector("passAttack", 1)),
        makeScriptedStep(makeResponseSelector("passAttack", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0)),
        makeScriptedStep(makeResponseSelector("passDamage", 1)),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          after: {
            source: "edopro",
            note: "EDOPro opens end damage step before the final pair of battle response passes",
            waitingFor: 1,
            pendingBattle: true,
            battleStep: "damage",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro passes end damage step priority back to the turn player after the opponent passes",
            waitingFor: 0,
            pendingBattle: true,
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage")],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro clears the pending battle after both players pass end damage step responses",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
            damagePasses: [],
            lifePoints: { 1: 6200 },
            eventHistory: [
              { eventName: "phaseStartBattle" },
              { eventName: "phaseChanged" },
              { eventName: "phaseBattle" },
              { eventName: "attackDeclared", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleStarted", eventCode: 1132 },
              { eventName: "battleConfirmed", eventCode: 1133 },
              { eventName: "beforeDamageCalculation", eventCode: 1134 },
              { eventName: "afterDamageCalculation", eventCode: 1138 },
              { eventName: "damageStepEnded", eventCode: 1141 },
              { eventName: "beforeBattleDamage" },
              { eventName: "battleDamageDealt" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open", count: 0 }],
            legalActionGroups: [directAttackGroup(0, "p0-deck-100-0", 0)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state has no pending battle window after direct battle damage resolves",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        battleWindow: null,
        attacksDeclared: ["p0-deck-100-0"],
        lifePoints: { 1: 6200 },
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open", count: 0 }],
        legalActionGroups: [directAttackGroup(0, "p0-deck-100-0", 0)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
