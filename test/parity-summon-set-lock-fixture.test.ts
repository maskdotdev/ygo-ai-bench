import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity summon and set lock fixtures", () => {
  it("removes Normal Summon actions for monsters affected by cannot-summon effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Normal Locked Monster", kind: "monster", attack: 1000, defense: 1000 }];
    const fixture: ScriptedDuelFixture = {
      name: "cannot normal summon legal action fixture",
      options: { seed: 82, startingHandSize: 1 },
      decks: { 0: { main: ["100"] }, 1: { main: [] } },
      setup: {
        effects: [{ id: "fixture-cannot-summon", player: 0, code: "100", location: "hand", event: "continuous", effectCode: 20, range: ["hand"] }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("setMonster", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro omits Normal Summon actions for monsters affected by CANNOT_SUMMON while still allowing legal Sets",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "setMonster", player: 0, code: "100", location: "hand", windowId: 0, windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "setMonster", player: 0, code: "100", location: "hand", windowId: 0, windowKind: "open", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "normalSummon", player: 0, uid: "p0-deck-100-0", windowId: 0, windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowId: 0,
                windowKind: "open",
                actions: [{ type: "normalSummon", player: 0, uid: "p0-deck-100-0", windowId: 0, windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro allows the same monster to be Set when only CANNOT_SUMMON applies",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            locations: { monsterZone: ["100"] },
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
        note: "EDOPro final fixture state contains the legally Set monster",
        phase: "main1",
        windowId: 1,
        locations: { monsterZone: ["100"] },
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
