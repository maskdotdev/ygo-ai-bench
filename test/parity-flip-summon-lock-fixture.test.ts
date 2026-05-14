import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup, summonGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity flip summon lock fixtures", () => {
  it("exposes Flip Summon actions for eligible face-down monsters", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Unlocked Flip Monster", kind: "monster", attack: 1000, defense: 1000 }];
    const fixture: ScriptedDuelFixture = {
      name: "unlocked flip summon legal action fixture",
      options: { seed: 80, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: [] },
      },
      setup: {
        moveCards: [{ player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceDownDefense" }],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("flipSummon", 0, { code: "100", location: "monsterZone" }), {
          snapshotRestore: "both",
          before: {
            source: "edopro",
            note: "EDOPro exposes Flip Summon actions for eligible face-down monsters that are not under CANNOT_FLIP_SUMMON",
            phase: "main1",
            windowId: 0,
            windowKind: "open",
            waitingFor: 0,
            legalActionCounts: { 0: 3, 1: 0 },
            legalActionGroupCounts: { 0: 2, 1: 0 },
            legalActions: [{ type: "flipSummon", player: 0, code: "100", location: "monsterZone", windowId: 0, windowKind: "open", count: 1 }],
            legalActionGroups: [summonGroup([{ type: "flipSummon", player: 0, code: "100", location: "monsterZone" }], 1, 0)],
          },
          after: {
            source: "edopro",
            note: "EDOPro resolves an eligible Flip Summon by turning the monster face-up Attack and recording flip summon events",
            phase: "main1",
            waitingFor: 0,
            cards: [{ uid: "p0-deck-100-0", position: "faceUpAttack", faceUp: true }],
            eventHistory: [
              { eventName: "flipSummoning", eventCardUid: "p0-deck-100-0" },
              { eventName: "flipSummoned", eventCardUid: "p0-deck-100-0" },
            ],
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
        note: "EDOPro final fixture state keeps the flipped monster face-up after a legal Flip Summon",
        phase: "main1",
        waitingFor: 0,
        windowId: 1,
        cards: [{ uid: "p0-deck-100-0", position: "faceUpAttack", faceUp: true }],
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
