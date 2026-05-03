import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity tribute summon lock fixtures", () => {
  it("removes Tribute Summon actions for high-level monsters affected by cannot-summon effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Tribute Locked Monster", kind: "monster", level: 5, attack: 2000, defense: 1000 },
      { code: "200", name: "Tribute Material", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cannot tribute summon legal action fixture",
      options: { seed: 85, startingHandSize: 2 },
      decks: { 0: { main: ["100", "200"] }, 1: { main: [] } },
      setup: {
        moveCards: [{ player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-cannot-tribute-summon",
            player: 0,
            code: "100",
            location: "hand",
            event: "continuous",
            effectCode: 20,
            range: ["hand"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro omits Tribute Summon actions for high-level monsters affected by CANNOT_SUMMON",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
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
            absentLegalActions: [{ type: "tributeSummon", player: 0, uid: "p0-deck-100-0", windowId: 0, windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowId: 0,
                windowKind: "open",
                actions: [{ type: "tributeSummon", player: 0, uid: "p0-deck-100-0", windowId: 0, windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro leaves the tribute-summon-locked monster in hand after advancing out of Main Phase 1",
            phase: "battle",
            locations: { hand: ["100"], monsterZone: ["200"] },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves the high-level monster in hand when Tribute Summon is locked",
        phase: "battle",
        locations: { hand: ["100"], monsterZone: ["200"] },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
