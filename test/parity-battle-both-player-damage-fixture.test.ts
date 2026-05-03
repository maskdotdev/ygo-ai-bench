import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { passBattleGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle both-player damage fixtures", () => {
  it("applies both-player battle damage effects from battling cards", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Both Damage Attacker", kind: "monster", attack: 1800, defense: 1200 }];
    const fixture: ScriptedDuelFixture = {
      name: "both player battle damage fixture",
      options: { seed: 86, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-both-battle-damage",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 206,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0" }), {
          after: {
            source: "edopro",
            note: "EDOPro opens the direct-attack response window before both-player battle damage is applied",
            waitingFor: 1,
            windowKind: "battle",
            pendingBattle: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            legalActionCounts: { 0: 0, 1: 1 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [{ type: "passAttack", player: 1, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(1, "passAttack")],
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
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro applies BOTH_BATTLE_DAMAGE by making the source controller also take the applied battle damage",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            lifePoints: { 0: 6200, 1: 6200 },
            battleDamage: { 0: 1800, 1: 1800 },
            attacksDeclared: ["p0-deck-100-0"],
            logIncludes: ["1800", "Direct attack"],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves both-player direct battle damage",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        lifePoints: { 0: 6200, 1: 6200 },
        battleDamage: { 0: 1800, 1: 1800 },
        attacksDeclared: ["p0-deck-100-0"],
        logIncludes: ["1800", "Direct attack"],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
