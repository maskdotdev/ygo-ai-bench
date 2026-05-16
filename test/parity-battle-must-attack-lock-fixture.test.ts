import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentTurnGroup, attackGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity battle must-attack lock fixtures", () => {
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
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro keeps the Main Phase open window restorable before applying MUST_ATTACK battle action locks",
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
            note: "EDOPro keeps Battle Phase progression locked while a monster affected by MUST_ATTACK still has a legal attack",
            phase: "battle",
            waitingFor: 0,
            pendingBattle: false,
            currentAttack: false,
            windowId: 1,
            windowKind: "open",
            battleWindow: null,
            attacksDeclared: [],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open", count: 1 },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }, { attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0" }], 1, 1)],
            absentLegalActions: [
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open" },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open" },
            ],
            absentLegalActionGroups: [absentTurnGroup("changePhase", 1), absentTurnGroup("endTurn", 1)],
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
        windowId: 1,
        windowKind: "open",
        battleWindow: null,
        attacksDeclared: [],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open", count: 1 },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0", windowId: 1, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [attackGroup([{ attackerUid: "p0-deck-100-0", targetUid: "p1-deck-200-0" }, { attackerUid: "p0-deck-101-1", targetUid: "p1-deck-200-0" }], 1, 1)],
        absentLegalActions: [
          { type: "changePhase", player: 0, windowId: 1, windowKind: "open" },
          { type: "endTurn", player: 0, windowId: 1, windowKind: "open" },
        ],
        absentLegalActionGroups: [absentTurnGroup("changePhase", 1), absentTurnGroup("endTurn", 1)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
