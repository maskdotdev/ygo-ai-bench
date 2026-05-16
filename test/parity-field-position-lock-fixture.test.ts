import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { attackGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity field position lock fixtures", () => {
  it("removes manual position changes when another monster applies cannot-change-position to its field", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Locked Monster", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Position Lock Source", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "field scoped cannot change position legal action fixture",
      options: { seed: 79, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "200"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-field-cannot-change-position",
            player: 0,
            code: "200",
            location: "monsterZone",
            event: "continuous",
            effectCode: 14,
            range: ["monsterZone"],
            targetRange: [1, 0],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro field-scoped CANNOT_CHANGE_POSITION effects suppress affected monsters' manual position-change actions",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", position: "faceUpDefense", windowId: 0, windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Actions",
                windowId: 0,
                windowKind: "open",
                actions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", position: "faceUpDefense", windowId: 0, windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps the field-locked monster unchanged after the phase advances",
            phase: "battle",
            windowId: 1,
            windowKind: "open",
            locations: { monsterZone: ["100", "200"] },
            positionsChanged: [],
            legalActionCounts: { 0: 4, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 1, windowKind: "open", count: 1 },
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-200-1", directAttack: true, windowId: 1, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              attackGroup([
                { attackerUid: "p0-deck-100-0", directAttack: true },
                { attackerUid: "p0-deck-200-1", directAttack: true },
              ], 1, 1),
              turnGroup(1),
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves field-scoped position locks",
        phase: "battle",
        windowId: 1,
        windowKind: "open",
        locations: { monsterZone: ["100", "200"] },
        positionsChanged: [],
        legalActionCounts: { 0: 4, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 1, windowKind: "open", count: 1 },
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-200-1", directAttack: true, windowId: 1, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          attackGroup([
            { attackerUid: "p0-deck-100-0", directAttack: true },
            { attackerUid: "p0-deck-200-1", directAttack: true },
          ], 1, 1),
          turnGroup(1),
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
