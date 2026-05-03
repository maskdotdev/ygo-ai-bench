import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

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
            waitingFor: 0,
            legalActions: [{ type: "setMonster", player: 0, code: "100", location: "hand", windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowKind: "open",
                count: 1,
                actions: [{ type: "setMonster", player: 0, code: "100", location: "hand", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "normalSummon", player: 0, uid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowKind: "open",
                actions: [{ type: "normalSummon", player: 0, uid: "p0-deck-100-0" }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro allows the same monster to be Set when only CANNOT_SUMMON applies",
            phase: "main1",
            locations: { monsterZone: ["100"] },
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state contains the legally Set monster",
        phase: "main1",
        locations: { monsterZone: ["100"] },
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

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
        effects: [{ id: "fixture-cannot-tribute-summon", player: 0, code: "100", location: "hand", event: "continuous", effectCode: 20, range: ["hand"] }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro omits Tribute Summon actions for high-level monsters affected by CANNOT_SUMMON",
            phase: "main1",
            waitingFor: 0,
            legalActions: [{ type: "changePhase", player: 0, phase: "battle", windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePhase", player: 0, phase: "battle", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "tributeSummon", player: 0, uid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowKind: "open",
                actions: [{ type: "tributeSummon", player: 0, uid: "p0-deck-100-0" }],
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
            waitingFor: 0,
            legalActions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowKind: "open",
                count: 1,
                actions: [{ type: "normalSummon", player: 0, code: "100", location: "hand", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "setMonster", player: 0, uid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Summons",
                windowKind: "open",
                actions: [{ type: "setMonster", player: 0, uid: "p0-deck-100-0" }],
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
            waitingFor: 0,
            legalActions: [{ type: "changePhase", player: 0, phase: "battle", windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Turn",
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePhase", player: 0, phase: "battle", count: 1 }],
              },
            ],
            absentLegalActions: [{ type: "setSpellTrap", player: 0, uid: "p0-deck-100-0", windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Set",
                windowKind: "open",
                actions: [{ type: "setSpellTrap", player: 0, uid: "p0-deck-100-0" }],
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
