import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity Main Phase 2 entry lock fixtures", () => {
  it("skips Main Phase 2 legal actions for players affected by cannot-enter-main2 effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Main Phase 2 Lock Source", kind: "monster", attack: 1000, defense: 1000 }];
    const fixture: ScriptedDuelFixture = {
      name: "cannot enter main2 legal action fixture",
      options: { seed: 83, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-cannot-m2",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 186,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "end" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro omits Main Phase 2 and exposes End Phase when CANNOT_M2 prevents entering Main Phase 2",
            phase: "battle",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 1, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, phase: "end", windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Attacks",
                windowId: 1,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "declareAttack", player: 0, attackerUid: "p0-deck-100-0", directAttack: true, windowId: 1, windowKind: "open", count: 1 },
                ],
              },
              {
                player: 0,
                label: "Turn",
                windowId: 1,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePhase", player: 0, phase: "end", windowId: 1, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
                ],
              },
            ],
            absentLegalActions: [{ type: "changePhase", player: 0, phase: "main2", windowId: 1, windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowId: 1,
                windowKind: "open",
                actions: [{ type: "changePhase", player: 0, phase: "main2", windowId: 1, windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro accepts End Phase as the next available phase after Main Phase 2 is blocked",
            phase: "end",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowId: 2,
                windowKind: "open",
                count: 1,
                actions: [{ type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 }],
              },
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("endTurn", 0), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro lets the turn player end the turn from End Phase after CANNOT_M2 blocked Main Phase 2 entry",
            phase: "end",
            windowId: 2,
            windowKind: "open",
            waitingFor: 0,
            turn: 1,
            turnPlayer: 0,
            legalActionCounts: { 0: 1, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowId: 2,
                windowKind: "open",
                count: 1,
                actions: [{ type: "endTurn", player: 0, windowId: 2, windowKind: "open", count: 1 }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro advances to the opponent's Main Phase 1 after ending a turn whose Main Phase 2 entry was blocked",
            phase: "main1",
            windowId: 3,
            windowKind: "open",
            waitingFor: 1,
            turn: 2,
            turnPlayer: 1,
            pendingBattle: false,
            battleWindow: null,
            legalActionCounts: { 0: 0, 1: 2 },
            legalActionGroupCounts: { 0: 0, 1: 1 },
            legalActions: [
              { type: "changePhase", player: 1, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 3, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 1,
                label: "Turn",
                windowId: 3,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePhase", player: 1, windowId: 3, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 1, windowId: 3, windowKind: "open", count: 1 },
                ],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state is the opponent's Main Phase 1 after ending a turn whose Main Phase 2 entry was blocked",
        phase: "main1",
        waitingFor: 1,
        turn: 2,
        turnPlayer: 1,
        pendingBattle: false,
        battleWindow: null,
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [
          { type: "changePhase", player: 1, windowId: 3, windowKind: "open", count: 1 },
          { type: "endTurn", player: 1, windowId: 3, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 1,
            label: "Turn",
            windowId: 3,
            windowKind: "open",
            count: 1,
            actions: [
              { type: "changePhase", player: 1, windowId: 3, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 3, windowKind: "open", count: 1 },
            ],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
