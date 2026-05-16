import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { passBattleGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity damage calculation window fixtures", () => {
  it("advances from before damage calculation to during damage calculation after both players pass", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Opponent Card", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "before calculation to during calculation fixture",
      options: { seed: 62, startingHandSize: 1 },
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
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "both",
          after: {
            source: "edopro",
            note: "EDOPro opens before damage calculation before that timing's first response pass",
            waitingFor: 1,
            windowId: 6,
            windowKind: "battle",
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowId: 6, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage", 1, 6)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 1), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps before damage calculation opponent priority restorable before the first response pass",
            phase: "battle",
            waitingFor: 1,
            windowId: 6,
            windowKind: "battle",
            pendingBattle: true,
            battleStep: "damage",
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowId: 6, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage", 1, 6)],
          },
          after: {
            source: "edopro",
            note: "EDOPro passes before damage calculation priority back to the turn player after the opponent passes",
            waitingFor: 0,
            windowId: 7,
            pendingBattle: true,
            battleStep: "damage",
            windowKind: "battle",
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowId: 7, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage", 1, 7)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps before damage calculation turn-player priority restorable before both players pass the window",
            phase: "battle",
            waitingFor: 0,
            windowId: 7,
            pendingBattle: true,
            battleStep: "damage",
            windowKind: "battle",
            battleWindow: { kind: "beforeDamageCalculation", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            damagePasses: [1],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowId: 7, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage", 1, 7)],
          },
          after: {
            source: "edopro",
            note: "EDOPro advances to during damage calculation after both players pass before damage calculation responses",
            waitingFor: 1,
            windowId: 8,
            pendingBattle: true,
            battleStep: "damageCalculation",
            windowKind: "battle",
            battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            damagePasses: [],
            eventHistory: [
              { eventName: "phaseStartBattle" },
              { eventName: "phaseChanged" },
              { eventName: "phaseBattle" },
              { eventName: "attackDeclared", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleStarted", eventCode: 1132 },
              { eventName: "battleConfirmed", eventCode: 1133 },
              { eventName: "beforeDamageCalculation", eventCode: 1134 },
              { eventName: "damageCalculating", eventCode: 1135 },
            ],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowId: 8, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage", 1, 8)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture window remains during damage calculation waiting for the non-turn player's response",
        phase: "battle",
        waitingFor: 1,
        windowId: 8,
        pendingBattle: true,
        battleStep: "damageCalculation",
        windowKind: "battle",
        battleWindow: { kind: "duringDamageCalculation", step: "damageCalculation", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 8, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passDamage", 1, 8)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
