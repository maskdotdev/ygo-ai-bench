import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { absentSummonGroup, attackGroup, turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Synchro material lock fixtures", () => {
  it("removes Synchro Summon actions when a selected material cannot be used as Synchro material", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Locked Synchro Tuner", kind: "monster", typeFlags: 0x1001, attack: 1000, defense: 1000 },
      { code: "200", name: "Free Synchro Non-Tuner", kind: "monster", attack: 1000, defense: 1000 },
      { code: "900", name: "Synchro Test Monster", kind: "extra", synchroMaterials: { tuner: "100", nonTuners: ["200"] }, attack: 2000, defense: 2000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "cannot synchro material legal action fixture",
      options: { seed: 91, startingHandSize: 2 },
      decks: { 0: { main: ["100", "200"], extra: ["900"] }, 1: { main: [] } },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-cannot-be-synchro-material",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 236,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro omits Synchro Summon actions when a required material is affected by EFFECT_CANNOT_BE_SYNCHRO_MATERIAL",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 4, 1: 0 },
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
            absentLegalActions: [{ type: "synchroSummon", player: 0, code: "900", location: "extraDeck", windowId: 0, windowKind: "open" }],
            absentLegalActionGroups: [absentSummonGroup({ type: "synchroSummon", player: 0, code: "900", location: "extraDeck" }, 0)],
          },
          after: {
            source: "edopro",
            note: "EDOPro leaves the blocked Synchro materials on the field after advancing out of Main Phase 1",
            phase: "battle",
            windowId: 1,
            windowKind: "open",
            locations: { extraDeck: ["900"], monsterZone: ["100", "200"] },
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
        note: "EDOPro final fixture state preserves the Synchro monster in the Extra Deck when material use is locked",
        phase: "battle",
        windowId: 1,
        windowKind: "open",
        locations: { extraDeck: ["900"], monsterZone: ["100", "200"] },
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
