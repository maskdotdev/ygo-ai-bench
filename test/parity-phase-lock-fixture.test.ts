import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

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
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "changePhase", player: 0, phase: "main2", windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePhase", player: 0, phase: "main2", windowKind: "open", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "changePhase", player: 0, phase: "battle", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                actions: [{ type: "changePhase", player: 0, phase: "battle", windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro accepts Main Phase 2 as the next available phase after SKIP_BP",
            phase: "main2",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state is Main Phase 2 after SKIP_BP skips Battle Phase entry",
        phase: "main2",
        waitingFor: 0,
        pendingBattle: false,
        battleWindow: null,
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("skips Battle Phase legal actions for players affected by cannot-enter-battle effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Battle Phase Lock Source", kind: "monster", attack: 1000, defense: 1000 }];
    const fixture: ScriptedDuelFixture = {
      name: "cannot enter battle phase legal action fixture",
      options: { seed: 84, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-cannot-bp",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 185,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "main2" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro omits Battle Phase and exposes Main Phase 2 when CANNOT_BP prevents entering Battle Phase",
            phase: "main1",
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "changePhase", player: 0, phase: "main2", windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePhase", player: 0, phase: "main2", windowKind: "open", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "changePhase", player: 0, phase: "battle", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                actions: [{ type: "changePhase", player: 0, phase: "battle", windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro accepts the next available phase after Battle Phase is blocked",
            phase: "main2",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state is Main Phase 2 after CANNOT_BP skips Battle Phase entry",
        phase: "main2",
        waitingFor: 0,
        pendingBattle: false,
        battleWindow: null,
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("skips Main Phase 2 legal actions for players affected by skip-main2 effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Main Phase 2 Skip Source", kind: "monster", attack: 1000, defense: 1000 }];
    const fixture: ScriptedDuelFixture = {
      name: "skip main2 legal action fixture",
      options: { seed: 80, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-skip-m2",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 184,
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
            note: "EDOPro omits Main Phase 2 and exposes End Phase when SKIP_M2 applies to the turn player",
            phase: "battle",
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "changePhase", player: 0, phase: "end", windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePhase", player: 0, phase: "end", windowKind: "open", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "changePhase", player: 0, phase: "main2", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                actions: [{ type: "changePhase", player: 0, phase: "main2", windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro accepts End Phase as the next available phase after SKIP_M2",
            phase: "end",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state is End Phase after SKIP_M2 skips Main Phase 2 entry",
        phase: "end",
        waitingFor: 0,
        pendingBattle: false,
        battleWindow: null,
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

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
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "changePhase", player: 0, phase: "end", windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePhase", player: 0, phase: "end", windowKind: "open", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "changePhase", player: 0, phase: "main2", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                actions: [{ type: "changePhase", player: 0, phase: "main2", windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro accepts End Phase as the next available phase after Main Phase 2 is blocked",
            phase: "end",
            waitingFor: 0,
            pendingBattle: false,
            battleWindow: null,
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state is End Phase after CANNOT_M2 skips Main Phase 2 entry",
        phase: "end",
        waitingFor: 0,
        pendingBattle: false,
        battleWindow: null,
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

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
