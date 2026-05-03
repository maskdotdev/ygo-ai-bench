import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle attack declaration lock fixtures", () => {
  it("removes all attack actions for monsters with cannot-attack effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Attack Locked Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Attack Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cannot attack legal action fixture",
      options: { seed: 96, startingHandSize: 1 },
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
            id: "fixture-cannot-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 85,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro suppresses every attack declaration for monsters affected by CANNOT_ATTACK",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            absentLegalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup()],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the monster's attack unused because all attacks are illegal",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        absentLegalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" },
        ],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup()],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("removes attack actions for monsters with cannot-attack-announce effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Announce Locked Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Announce Lock Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cannot attack announce legal action fixture",
      options: { seed: 77, startingHandSize: 1 },
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
            id: "fixture-cannot-attack-announce",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 86,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro suppresses attack declarations for monsters affected by CANNOT_ATTACK_ANNOUNCE",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            absentLegalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" },
            ],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup()],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the monster's attack unused because attack announcement is illegal",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        absentLegalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", windowKind: "open" },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" },
        ],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup()],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
