import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { directAttackGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity position lock fixtures", () => {
  it("removes manual position changes for monsters affected by cannot-change-position effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Position Locked Monster", kind: "monster", attack: 1000, defense: 1000 }];
    const fixture: ScriptedDuelFixture = {
      name: "cannot change position legal action fixture",
      options: { seed: 78, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-cannot-change-position",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 14,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro omits manual position-change actions for monsters affected by CANNOT_CHANGE_POSITION",
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
            note: "EDOPro keeps the position-locked monster unchanged after leaving Main Phase 1",
            phase: "battle",
            windowId: 1,
            windowKind: "open",
            locations: { monsterZone: ["100"] },
            positionsChanged: [],
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
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves the locked monster's unchanged position",
        phase: "battle",
        windowId: 1,
        locations: { monsterZone: ["100"] },
        positionsChanged: [],
        legalActionCounts: { 0: 3, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [
          { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 1, windowKind: "open", count: 1 },
          { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [directAttackGroup(0, "p0-deck-100-0", 1, 1), turnGroup(1)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
