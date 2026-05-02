import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";

describe("EDOPro parity position lock fixtures", () => {
  it("exposes and applies manual position changes for unlocked monsters", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Unlocked Position Monster", kind: "monster", attack: 1000, defense: 1000 }];
    const fixture: ScriptedDuelFixture = {
      name: "unlocked position change legal action fixture",
      options: { seed: 76, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePosition", 0, { code: "100", location: "monsterZone", position: "faceUpDefense" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes manual Attack-to-Defense position changes for eligible unlocked monsters",
            phase: "main1",
            waitingFor: 0,
            positionsChanged: [],
            legalActions: [{ type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowKind: "open", count: 1 }],
          },
          after: {
            source: "edopro",
            note: "EDOPro records a manual position change and removes repeat position-change actions for that monster",
            phase: "main1",
            waitingFor: 0,
            positionsChanged: ["p0-deck-100-0"],
            absentLegalActions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", windowKind: "open" }],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state records the unlocked monster's manual position change",
        phase: "main1",
        waitingFor: 0,
        positionsChanged: ["p0-deck-100-0"],
        absentLegalActions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", windowKind: "open" }],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("removes manual position changes for monsters affected by cannot-change-position effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Position Locked Monster", kind: "monster", attack: 1000, defense: 1000 }];
    const fixture: ScriptedDuelFixture = {
      name: "cannot change position legal action fixture",
      options: { seed: 78, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
        effects: [
          {
            id: "fixture-cannot-change-position",
            player: 0,
            code: "100",
            location: "monsterZone",
            event: "continuous",
            effectCode: 14,
            range: ["monsterZone"],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro omits manual position-change actions for monsters affected by CANNOT_CHANGE_POSITION",
            phase: "main1",
            waitingFor: 0,
            legalActions: [{ type: "changePhase", player: 0, phase: "battle", windowKind: "open", count: 1 }],
            absentLegalActions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", position: "faceUpDefense", windowKind: "open" }],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps the position-locked monster unchanged after leaving Main Phase 1",
            phase: "battle",
            locations: { monsterZone: ["100"] },
            positionsChanged: [],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves the locked monster's unchanged position",
        phase: "battle",
        locations: { monsterZone: ["100"] },
        positionsChanged: [],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });

  it("removes manual position changes when another monster applies cannot-change-position to its field", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Locked Monster", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Position Lock Source", kind: "monster", attack: 500, defense: 500 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "field scoped cannot change position legal action fixture",
      options: { seed: 79, startingHandSize: 2 },
      decks: {
        0: { main: ["100", "200"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "200", from: "hand", to: "monsterZone", position: "faceUpAttack" },
        ],
        effects: [
          {
            id: "fixture-field-cannot-change-position",
            player: 0,
            code: "200",
            location: "monsterZone",
            event: "continuous",
            effectCode: 14,
            range: ["monsterZone"],
            targetRange: [1, 0],
          },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro field-scoped CANNOT_CHANGE_POSITION effects suppress affected monsters' manual position-change actions",
            phase: "main1",
            waitingFor: 0,
            legalActions: [{ type: "changePhase", player: 0, phase: "battle", windowKind: "open", count: 1 }],
            absentLegalActions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", position: "faceUpDefense", windowKind: "open" }],
          },
          after: {
            source: "edopro",
            note: "EDOPro keeps the field-locked monster unchanged after the phase advances",
            phase: "battle",
            locations: { monsterZone: ["100", "200"] },
            positionsChanged: [],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state preserves field-scoped position locks",
        phase: "battle",
        locations: { monsterZone: ["100", "200"] },
        positionsChanged: [],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
