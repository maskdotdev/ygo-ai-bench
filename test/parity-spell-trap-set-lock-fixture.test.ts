import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity spell/trap set lock fixtures", () => {
  it("removes Spell/Trap Set actions for cards affected by cannot-sset effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Spell Set Locked", kind: "spell" }];
    const fixture: ScriptedDuelFixture = {
      name: "cannot spell trap set legal action fixture",
      options: { seed: 84, startingHandSize: 1 },
      decks: { 0: { main: ["100"] }, 1: { main: [] } },
      setup: {
        effects: [
          {
            id: "fixture-cannot-sset",
            player: 0,
            code: "100",
            location: "hand",
            event: "continuous",
            effectCode: 24,
            range: ["hand"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro omits Set actions for Spell/Trap cards affected by CANNOT_SSET",
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
            absentLegalActions: [{ type: "setSpellTrap", player: 0, uid: "p0-deck-100-0", windowId: 0, windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Set",
                windowId: 0,
                windowKind: "open",
                actions: [{ type: "setSpellTrap", player: 0, uid: "p0-deck-100-0", windowId: 0, windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro leaves the CANNOT_SSET card in hand after advancing out of Main Phase 1",
            phase: "battle",
            windowId: 1,
            windowKind: "open",
            locations: { hand: ["100"] },
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
        note: "EDOPro final fixture state preserves the Spell/Trap card in hand when SSet is locked",
        phase: "battle",
        windowId: 1,
        locations: { hand: ["100"] },
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
