import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity phase lock fixtures", () => {
  it("skips Battle Phase legal actions for players affected by skip-battle effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Battle Phase Skip Source", kind: "monster", attack: 1000, defense: 1000 }];
    const fixture: ScriptedDuelFixture = {
      name: "skip battle phase legal action fixture",
      options: { seed: 81, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-skip-bp",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 183,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro omits Battle Phase and exposes Main Phase 2 when SKIP_BP applies to the turn player",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 0, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, phase: "main2", windowId: 0, windowKind: "open", count: 1 },
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
                ],
              },
              {
                player: 0,
                label: "Turn",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePhase", player: 0, phase: "main2", windowId: 0, windowKind: "open", count: 1 },
                  { type: "endTurn", player: 0, windowId: 0, windowKind: "open", count: 1 },
                ],
              },
            ],
            absentLegalActions: [{ type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowId: 0,
                windowKind: "open",
                actions: [{ type: "changePhase", player: 0, phase: "battle", windowId: 0, windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro accepts Main Phase 2 as the next available phase after SKIP_BP",
            phase: "main2",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 1, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, phase: "end", windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Actions",
                windowId: 1,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 1, windowKind: "open", count: 1 },
                ],
              },
              turnGroup(1),
            ],
          },
        }),
        makeScriptedStep(makeResponseSelector("endTurn", 0), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro lets the turn player end the turn from Main Phase 2 after SKIP_BP skipped Battle Phase",
            phase: "main2",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            turn: 1,
            turnPlayer: 0,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [
              { type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 1, windowKind: "open", count: 1 },
              { type: "changePhase", player: 0, phase: "end", windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [
              {
                player: 0,
                label: "Actions",
                windowId: 1,
                windowKind: "open",
                count: 1,
                actions: [
                  { type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 1, windowKind: "open", count: 1 },
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
          },
          after: {
            source: "edopro",
            note: "EDOPro advances to the opponent's Main Phase 1 after ending a turn whose Battle Phase was skipped",
            phase: "main1",
            waitingFor: 1,
            turn: 2,
            turnPlayer: 1,
            pendingBattle: false,
            battleWindow: null,
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state is the opponent's Main Phase 1 after ending a turn whose Battle Phase was skipped",
        phase: "main1",
        waitingFor: 1,
        turn: 2,
        turnPlayer: 1,
        pendingBattle: false,
        battleWindow: null,
        legalActionCounts: { 0: 0, 1: 2 },
        legalActionGroupCounts: { 0: 0, 1: 1 },
        legalActions: [
          { type: "changePhase", player: 1, windowId: 2, windowKind: "open", count: 1 },
          { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [
          {
            player: 1,
            label: "Turn",
            windowId: 2,
            windowKind: "open",
            count: 1,
            actions: [
              { type: "changePhase", player: 1, windowId: 2, windowKind: "open", count: 1 },
              { type: "endTurn", player: 1, windowId: 2, windowKind: "open", count: 1 },
            ],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
