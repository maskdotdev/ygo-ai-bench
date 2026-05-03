import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, attackGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle direct-attack lock fixtures", () => {
  it("allows direct-attack effects through occupied monster zones", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Direct Attack Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Direct Attack Bypass Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "direct attack legal action fixture",
      options: { seed: 88, startingHandSize: 1 },
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
            id: "fixture-direct-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 74,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro exposes both direct and targeted attacks for monsters affected by DIRECT_ATTACK while opposing monsters exist",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            battleWindow: null,
            attacksDeclared: [],
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowKind: "open", count: 1 },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }, { attackerUid: "p0-deck-100-0", directAttack: true }])],
          },
        }),
        makeScriptedStep(makeResponseSelector("declareAttack", 0, { attackerUid: "p0-deck-100-0", directAttack: true }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro accepts direct attack declarations from DIRECT_ATTACK monsters without choosing an attack target",
            waitingFor: 1,
            pendingBattle: true,
            currentAttack: true,
            battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
            attacksDeclared: ["p0-deck-100-0"],
            battlePairs: [],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state keeps the direct attack pending without a battle target",
        phase: "battle",
        waitingFor: 1,
        pendingBattle: true,
        currentAttack: true,
        battleWindow: { kind: "attackNegationResponse", step: "attack", attackerUid: "p0-deck-100-0", responsePlayer: 1 },
        attacksDeclared: ["p0-deck-100-0"],
        battlePairs: [],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("lets cannot-direct-attack override direct-attack permissions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Conflicting Direct Attacker", kind: "monster", attack: 1800, defense: 1200 },
      { code: "200", name: "Conflicting Direct Target", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "direct attack blocked by cannot direct fixture",
      options: { seed: 87, startingHandSize: 1 },
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
            id: "fixture-direct-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 74,
            range: ["monsterZone"],
          },
          {
            id: "fixture-cannot-direct-attack",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 73,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro keeps targeted attacks legal but suppresses direct declarations when CANNOT_DIRECT_ATTACK conflicts with DIRECT_ATTACK",
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
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, true)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves targeted attacks while the direct attack grant is blocked",
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
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", undefined, true)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
