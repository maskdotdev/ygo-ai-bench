import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity position change fixtures", () => {
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
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            positionsChanged: [],
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 0, windowKind: "open", count: 1 }],
            legalActionGroups: [
              {
                player: 0,
                label: "Actions",
                windowId: 0,
                windowKind: "open",
                count: 1,
                actions: [{ type: "changePosition", player: 0, code: "100", location: "monsterZone", position: "faceUpDefense", windowId: 0, windowKind: "open", count: 1 }],
              },
            ],
          },
          after: {
            source: "edopro",
            note: "EDOPro records a manual position change and removes repeat position-change actions for that monster",
            phase: "main1",
            windowId: 1,
            windowKind: "open",
            waitingFor: 0,
            positionsChanged: ["p0-deck-100-0"],
            legalActionCounts: { 0: 2, 1: 0 },
            legalActionGroupCounts: { 0: 1, 1: 0 },
            legalActions: [
              { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
              { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
            ],
            legalActionGroups: [turnGroup(1)],
            absentLegalActions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 1, windowKind: "open" }],
            absentLegalActionGroups: [
              {
                player: 0,
                label: "Actions",
                windowId: 1,
                windowKind: "open",
                actions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 1, windowKind: "open" }],
              },
            ],
          },
        }),
      ],
      expected: {
        source: "edopro",
        note: "EDOPro final fixture state records the unlocked monster's manual position change",
        phase: "main1",
        windowId: 1,
        waitingFor: 0,
        positionsChanged: ["p0-deck-100-0"],
        legalActionCounts: { 0: 2, 1: 0 },
        legalActionGroupCounts: { 0: 1, 1: 0 },
        legalActions: [
          { type: "changePhase", player: 0, windowId: 1, windowKind: "open", count: 1 },
          { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },
        ],
        legalActionGroups: [turnGroup(1)],
        absentLegalActions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 1, windowKind: "open" }],
        absentLegalActionGroups: [
          {
            player: 0,
            label: "Actions",
            windowId: 1,
            windowKind: "open",
            actions: [{ type: "changePosition", player: 0, uid: "p0-deck-100-0", windowId: 1, windowKind: "open" }],
          },
        ],
      },
    };

    expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
  });
});
