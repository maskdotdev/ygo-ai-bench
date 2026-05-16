import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import {
  directAttackGroup,
  passBattleGroup,
  turnGroup,
} from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle window fixtures", () => {
  it("opens attack response windows and advances into the damage step after both players pass", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Opponent Card", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "direct attack response to damage step fixture",
      options: { seed: 60, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro exposes battle-phase direct attack declarations only after entering Battle Phase",
            phase: "battle",
            waitingFor: 0,
            windowId: 1,
            windowKind: "open",
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 1, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [directAttackGroup(0, "p0-deck-100-0", 1, 1), turnGroup(1)],
          },
        }),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the battle-phase direct attack declaration window restorable before attack declaration",
            phase: "battle",
            waitingFor: 0,
            windowId: 1,
            windowKind: "open",
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
            note: "EDOPro gives the non-turn player the first attack-response window after attack declaration",
            waitingFor: 1,
            windowId: 2,
            pendingBattle: true,
            currentAttack: true,
            battleStep: "attack",
            windowKind: "battle",
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            attackPasses: [],
            attacksDeclared: ["p0-deck-100-0"],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passAttack", player: 1, windowId: 2, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passAttack", 1, 2)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 1), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro passes the attack-response window back to the turn player after the opponent passes",
            waitingFor: 0,
            windowId: 3,
            pendingBattle: true,
            battleStep: "attack",
            windowKind: "battle",
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            attackPasses: [1],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passAttack", player: 0, windowId: 3, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passAttack", 1, 3)],
          },
        }),
        makeScriptedStep(makeResponseSelector("passAttack", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the turn-player attack-response pass window restorable before advancing to the damage step",
            waitingFor: 0,
            windowId: 3,
            pendingBattle: true,
            battleStep: "attack",
            windowKind: "battle",
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 0 },
            attackPasses: [1],
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passAttack", player: 0, windowId: 3, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passAttack", 1, 3)],
          },
          after: {
            source: "edopro",
            note: "EDOPro advances to the start damage step after both players pass attack responses",
            waitingFor: 1,
            windowId: 4,
            pendingBattle: true,
            battleStep: "damage",
            windowKind: "battle",
            battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            attackPasses: [],
            damagePasses: [],
            eventHistory: [
              { eventName: "phaseStartBattle" },
              { eventName: "phaseChanged" },
              { eventName: "phaseBattle" },
              { eventName: "attackDeclared", eventCardUid: "p0-deck-100-0" },
              { eventName: "battleStarted", eventCode: 1132 },
              { eventName: "battleConfirmed", eventCode: 1133 },
            ],
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passDamage", player: 1, windowId: 4, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passDamage", 1, 4)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture window remains at start damage step waiting for the non-turn player's damage response",
        phase: "battle",
        waitingFor: 1,
        windowId: 4,
        pendingBattle: true,
        battleStep: "damage",
        windowKind: "battle",
        battleWindow: { kind: "startDamageStep", step: "damage", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
        legalActionCounts: { 0: 0, 1: 1 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [{ type: "passDamage", player: 1, windowId: 4, windowKind: "battle", count: 1 }],
        legalActionGroups: [passBattleGroup(1, "passDamage", 1, 4)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

});
