import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentSummonGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Fusion material lock fixtures", () => {
  it("removes Fusion Summon actions when a selected material cannot be used as Fusion material", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Locked Fusion Material", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Free Fusion Material", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Fusion Test Monster", kind: "extra", fusionMaterials: ["100", "200"], attack: 2000, defense: 2000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cannot fusion material legal action fixture",
      options: { seed: 92, startingHandSize: 2 },
      decks: { 0: { main: ["100", "200"], extra: ["900"] }, 1: { main: [] } },
      setup: {
        effects: [
          {
            id: "fixture-cannot-be-fusion-material",
            player: 0,
            code: "100",
            location: "hand",
            event: "continuous",
            effectCode: 235,
            range: ["hand"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro omits Fusion Summon actions when a required material is affected by EFFECT_CANNOT_BE_FUSION_MATERIAL",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 6, 1: 0 },
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
            absentLegalActions: [{ type: "fusionSummon", player: 0, code: "900", location: "extraDeck", windowId: 0, windowKind: "open" }],
            absentLegalActionGroups: [absentSummonGroup({ type: "fusionSummon", player: 0, code: "900", location: "extraDeck" }, 0)],
          },
          after: {
            source: "edopro",
            note: "EDOPro leaves the blocked Fusion materials in hand after advancing out of Main Phase 1",
            phase: "battle",
            windowId: 1,
            windowKind: "open",
            locations: { extraDeck: ["900"], hand: ["100", "200"] },
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
        note: "EDOPro final fixture state preserves the Fusion monster in the Extra Deck when material use is locked",
        phase: "battle",
        windowId: 1,
        locations: { extraDeck: ["900"], hand: ["100", "200"] },
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
