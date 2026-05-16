import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, attackGroup, passBattleGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

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

describe("EDOPro parity battle repeat attack fixtures", () => {
  it("allows attack-all monsters to attack each opposing monster once", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attack All Attacker", kind: "monster", attack: 3000, defense: 2500 },
      { code: "200", name: "First Attack-All Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Second Attack-All Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "attack all legal action fixture",
      options: { seed: 92, startingHandSize: 2 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200", "300"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "300", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-attack-all",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 193,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" })),
        ...resolveBattleStepsBeforeFinalPass,
        makeScriptedStep(makeResponseSelector("passDamage", 0), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the first attack-all target on field before the final end-damage-step pass recalculates remaining attacks",
            phase: "battle",
            waitingFor: 0,
            windowId: 13,
            windowKind: "battle",
            pendingBattle: true,
            currentAttack: true,
            battleStep: "damage",
            battleWindow: { kind: "endDamageStep", step: "damage", attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", responsePlayer: 0 },
            damagePasses: [1],
            locations: { monsterZone: ["100", "200", "300"] },
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "passDamage", player: 0, windowId: 13, windowKind: "battle", count: 1 }],
            legalActionGroups: [passBattleGroup(0, "passDamage", 1, 13)],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps ATTACK_ALL attackers legal against remaining opposing monsters after one battle resolves",
            phase: "battle",
            windowId: 14,
            windowKind: "open",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
            locations: { monsterZone: ["100", "300"], graveyard: ["200"] },
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowId: 14, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1" }], 1, 14), turnGroup(14)],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 14, windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-200-0", undefined, 14)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state exposes the next remaining attack-all target",
        phase: "battle",
        windowId: 14,
        windowKind: "open",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: ["p0-deck-100-0"],
        battlePairs: [{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }],
        locations: { monsterZone: ["100", "300"], graveyard: ["200"] },
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowId: 14, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 14, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 14, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1" }], 1, 14), turnGroup(14)],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 14, windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-200-0", undefined, 14)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
