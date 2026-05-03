import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity End Phase lock fixtures", () => {
  it("removes End Phase legal actions for players affected by cannot-enter-end effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "End Phase Lock Source", kind: "monster", attack: 1000, defense: 1000 }];
    const fixture: ScriptedDuelFixture = {
      name: "cannot enter end phase legal action fixture",
      options: { seed: 82, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-cannot-ep",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 187,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro omits End Phase transition actions when CANNOT_EP prevents entering End Phase",
            phase: "main2",
            windowKind: "open",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "endTurn", player: 0, windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                count: 1,
                actions: [{ type: "endTurn", player: 0, windowKind: "open", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "changePhase", player: 0, phase: "end", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                actions: [{ type: "changePhase", player: 0, phase: "end", windowKind: "open" }],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state remains Main Phase 2 with explicit End Phase entry blocked",
        phase: "main2",
        windowKind: "open",
        waitingFor: 0,
        pendingBattle: false,
        battleWindow: null,
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [{ type: "endTurn", player: 0, windowKind: "open", count: 1 }],
        legalActionGroups: [
          {
            player: 0,
            label: "Turn",
            windowKind: "open",
            count: 1,
            actions: [{ type: "endTurn", player: 0, windowKind: "open", count: 1 }],
          },
        ],
        absentLegalActions: [{ type: "changePhase", player: 0, phase: "end", windowKind: "open" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Turn",
            windowKind: "open",
            actions: [{ type: "changePhase", player: 0, phase: "end", windowKind: "open" }],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("removes End Phase legal actions for players affected by skip-end effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "End Phase Skip Source", kind: "monster", attack: 1000, defense: 1000 }];
    const fixture: ScriptedDuelFixture = {
      name: "skip end phase legal action fixture",
      options: { seed: 79, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-skip-ep",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 189,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" })),
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" }), {
          snapshotRestore: "after",
          after: {
            source: "edopro",
            note: "EDOPro omits End Phase transition actions when SKIP_EP applies to the turn player",
            phase: "main2",
            windowKind: "open",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "endTurn", player: 0, windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                count: 1,
                actions: [{ type: "endTurn", player: 0, windowKind: "open", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "changePhase", player: 0, phase: "end", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                actions: [{ type: "changePhase", player: 0, phase: "end", windowKind: "open" }],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state remains Main Phase 2 with explicit End Phase entry skipped",
        phase: "main2",
        windowKind: "open",
        waitingFor: 0,
        pendingBattle: false,
        battleWindow: null,
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 2, 1: 0 },
        legalActions: [{ type: "endTurn", player: 0, windowKind: "open", count: 1 }],
        legalActionGroups: [
          {
            player: 0,
            label: "Turn",
            windowKind: "open",
            count: 1,
            actions: [{ type: "endTurn", player: 0, windowKind: "open", count: 1 }],
          },
        ],
        absentLegalActions: [{ type: "changePhase", player: 0, phase: "end", windowKind: "open" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Turn",
            windowKind: "open",
            actions: [{ type: "changePhase", player: 0, phase: "end", windowKind: "open" }],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
