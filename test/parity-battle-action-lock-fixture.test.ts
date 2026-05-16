import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentAttackGroup, attackGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

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
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the Main Phase open window restorable before applying FIRST_ATTACK battle action locks",
            phase: "main1",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            windowId: 0,
            windowKind: "open",
            battleWindow: null,
            attacksDeclared: [],
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 0, windowKind: "open", count: 1 },
              { type: "changePosition", player: 0, code: "101", location: "monsterZone", position: "faceUpDefense", windowId: 0, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 0, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Actions",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 0, windowKind: "open", count: 1 },
                  { type: "changePosition", player: 0, code: "101", location: "monsterZone", position: "faceUpDefense", windowId: 0, windowKind: "open", count: 1 },
                ],
              },
              turnGroup(0),
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro exposes only FIRST_ATTACK monsters until one of them has attacked",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            windowId: 1,
            windowKind: "open",
            battleWindow: null,
            attacksDeclared: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0" }], 1, 1), turnGroup(1)],
            absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open" }],
            absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-200-0", undefined, 1)],
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
        windowId: 1,
        windowKind: "open",
        battleWindow: null,
        attacksDeclared: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0" }], 1, 1), turnGroup(1)],
        absentLegalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open" }],
        absentLegalActionGroups: [absentAttackGroup("p0-deck-100-0", "p1-deck-200-0", undefined, 1)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
