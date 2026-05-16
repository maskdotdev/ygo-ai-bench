import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Ritual material lock fixtures", () => {
  it("removes Ritual Summon actions when a selected material cannot be used as material", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Locked Ritual Material", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Free Ritual Material", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Ritual Test Monster", kind: "monster", ritualMaterials: ["100", "200"], attack: 2000, defense: 2000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cannot ritual material legal action fixture",
      options: { seed: 93, startingHandSize: 3 },
      decks: { 0: { main: ["900", "100", "200"] }, 1: { main: [] } },
      setup: {
        effects: [
          {
            id: "fixture-cannot-be-ritual-material",
            player: 0,
            code: "100",
            location: "hand",
            event: "continuous",
            effectCode: 248,
            range: ["hand"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro omits Ritual Summon actions when a required material is affected by EFFECT_CANNOT_BE_MATERIAL",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 8, 1: 0 },
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
            absentLegalActions: [{ type: "ritualSummon", player: 0, code: "900", location: "hand", windowId: 0, windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowId: 0,
                windowKind: "open",
                actions: [{ type: "ritualSummon", player: 0, code: "900", location: "hand", windowId: 0, windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro leaves the blocked Ritual materials in hand after advancing out of Main Phase 1",
            phase: "battle",
            windowId: 1,
            windowKind: "open",
            locations: { hand: ["900", "100", "200"] },
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(1)],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves the Ritual monster in hand when material use is locked",
        phase: "battle",
        windowId: 1,
        locations: { hand: ["900", "100", "200"] },
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(1)],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
