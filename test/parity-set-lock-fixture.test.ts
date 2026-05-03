import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity set lock fixtures", () => {
  it("removes Monster Set actions for monsters affected by cannot-mset effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Monster Set Locked", kind: "monster", attack: 1000, defense: 1000 }];
    const fixture: ScriptedDuelFixture = {
      name: "cannot monster set legal action fixture",
      options: { seed: 83, startingHandSize: 1 },
      decks: { 0: { main: ["100"] }, 1: { main: [] } },
      setup: {
        effects: [{ id: "fixture-cannot-mset", player: 0, code: "100", location: "hand", event: "continuous", effectCode: 23, range: ["hand"] }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("normalSummon", 0, { code: "100", location: "hand" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro omits Monster Set actions for monsters affected by CANNOT_MSET while still allowing legal Normal Summons",
            phase: "main1",
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowKind: "open",
                count: 1,
                actions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", windowKind: "open", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "setMonster", player: 0, uid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowKind: "open",
                actions: [{ type: "setMonster", player: 0, uid: "p0-deck-100-0", windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro allows the same monster to be Normal Summoned when only CANNOT_MSET applies",
            phase: "main1",
            locations: { monsterZone: ["100"] },
            eventHistory: [
              { eventName: "normalSummoning", eventCardUid: "p0-deck-100-0" },
              { eventName: "normalSummoned", eventCardUid: "p0-deck-100-0" },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state contains the legally Normal Summoned monster",
        phase: "main1",
        locations: { monsterZone: ["100"] },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("removes Spell/Trap Set actions for cards affected by cannot-sset effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Spell Set Locked", kind: "spell" }];
    const fixture: ScriptedDuelFixture = {
      name: "cannot spell trap set legal action fixture",
      options: { seed: 84, startingHandSize: 1 },
      decks: { 0: { main: ["100"] }, 1: { main: [] } },
      setup: {
        effects: [{ id: "fixture-cannot-sset", player: 0, code: "100", location: "hand", event: "continuous", effectCode: 24, range: ["hand"] }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro omits Set actions for Spell/Trap cards affected by CANNOT_SSET",
            phase: "main1",
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [{ type: "changePhase", player: 0, phase: "battle", windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePhase", player: 0, phase: "battle", windowKind: "open", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "setSpellTrap", player: 0, uid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Set",
                windowKind: "open",
                actions: [{ type: "setSpellTrap", player: 0, uid: "p0-deck-100-0", windowKind: "open" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro leaves the CANNOT_SSET card in hand after advancing out of Main Phase 1",
            phase: "battle",
            locations: { hand: ["100"] },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves the Spell/Trap card in hand when SSet is locked",
        phase: "battle",
        locations: { hand: ["100"] },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
