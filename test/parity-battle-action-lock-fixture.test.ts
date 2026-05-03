import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, absentTurnGroup, attackGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle action lock fixtures", () => {
  it("requires first-attack monsters to attack before other monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Delayed Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "101", name: "Required First Attacker", kind: "monster", attack: 1600, defense: 1200 },
      { code: "200", name: "First Attack Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "first attack legal action fixture",
      options: { seed: 99, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "101"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "101", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-first-attack",
            player: 0,
            code: "101",
            location: "monsterZone",
            event: "continuous",
            effectCode: 192,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro exposes only FIRST_ATTACK monsters until one of them has attacked",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0" }])],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-200-0")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves first-attack ordering in the legal action surface",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
        legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0" }])],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-200-0")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("forces attacks toward only-be-attacked monsters", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Forced Target Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Must Be Attacked Target", kind: "monster", attack: 1000, defense: 1000 },
      { code: "300", name: "Bypassed Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "only be attacked legal action fixture",
      options: { seed: 98, startingHandSize: 2 },
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
            id: "fixture-only-be-attacked",
            player: 1,
            code: "200",
            location: "monsterZone",
            event: "continuous",
            effectCode: 196,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro forces attack target selection toward monsters affected by ONLY_BE_ATTACKED",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }])],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-300-1")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state exposes only the required battle target",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 }],
        legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }])],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-300-1", windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-300-1")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("keeps the battle phase open while must-attack monsters can still attack", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Must Attack Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "101", name: "Free Attacker", kind: "monster", attack: 1600, defense: 1200 },
      { code: "200", name: "Must Attack Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "must attack legal action fixture",
      options: { seed: 94, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "101"] },
        1: { main: ["200"] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "101", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 1, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-must-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 191,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro keeps Battle Phase progression locked while a monster affected by MUST_ATTACK still has a legal attack",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 },
            ],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }, { attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0" }])],
            absentLegalActions: [
              { type: "changePhase", player: 0, windowKind: "open" },
              { type: "endTurn", player: 0, windowKind: "open" },
            ],
            absentLegalActionGroups: [absentTurnGroup("changePhase"), absentTurnGroup("endTurn")],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state exposes attacks but withholds phase/end-turn actions until the must-attack requirement is satisfied",
        phase: "battle",
        waitingFor: 0,
        pendingBattle: false,
        currentAttack: false,
        battleWindow: null,
        attacksDeclared: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 },
        ],
        legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }, { attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0" }])],
        absentLegalActions: [
          { type: "changePhase", player: 0, windowKind: "open" },
          { type: "endTurn", player: 0, windowKind: "open" },
        ],
        absentLegalActionGroups: [absentTurnGroup("changePhase"), absentTurnGroup("endTurn")],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
