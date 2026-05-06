import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { attackGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

const resolveBattleStepsBeforeFinalPass = [
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
];

describe("EDOPro parity battle extra attack fixtures", () => {
  it("allows extra-attack monsters to attack directly after clearing the field", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Extra Attack Attacker", kind: "monster", attack: 3000, defense: 2500 },
      { code: "200", name: "Only Extra Attack Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "extra attack direct legal action fixture",
      options: { seed: 91, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-extra-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 194,
            value: 1,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" })),
        ...resolveBattleStepsBeforeFinalPass,
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro lets general EXTRA_ATTACK attackers use their remaining attack directly when the opponent controls no monsters",
            phase: "battle",
            windowId: 14,
            windowKind: "open",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
            locations: { monsterZone: ["100"], graveyard: ["200"] },
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 14, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0" }], 1, 14), turnGroup(14)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state exposes the direct extra attack after the field is cleared",
        phase: "battle",
        windowId: 14,
        windowKind: "open",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: ["p0-deck-100-0"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
        locations: { monsterZone: ["100"], graveyard: ["200"] },
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 14, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0" }], 1, 14), turnGroup(14)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
