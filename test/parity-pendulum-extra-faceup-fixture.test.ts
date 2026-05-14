import { describe, expect, it } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, ScriptedDuelFixture } from "#duel/types.js";
import { turnGroup } from "./parity-legal-action-group-helpers.js";

describe("EDOPro parity Pendulum extra deck fixtures", () => {
  it("keeps Pendulum monsters face-up when they move from the field to the Extra Deck", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Pendulum Extra Monster", kind: "monster", typeFlags: 0x1000001, level: 4, attack: 1000, defense: 1000 },
    ];
    const fixture: ScriptedDuelFixture = {
      name: "pendulum field to face-up extra fixture",
      options: { seed: 95, startingHandSize: 1 },
      decks: { 0: { main: ["100"] }, 1: { main: [] } },
      setup: {
        moveCards: [
          { player: 0, code: "100", from: "hand", to: "monsterZone", position: "faceUpAttack" },
          { player: 0, code: "100", from: "monsterZone", to: "extraDeck" },
        ],
      },
      responses: [
        makeScriptedStep(makeResponseSelector("changePhase", 0, { phase: "battle" }), {
          snapshotRestore: "before",
          before: {
            source: "edopro",
            note: "EDOPro keeps Pendulum monsters face-up in the Extra Deck after they leave the field for the Extra Deck",
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
            locations: { extraDeck: ["100"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "extraDeck", faceUp: true, position: "faceDown" }],
          },
          after: {
            source: "edopro",
            note: "EDOPro preserves face-up Extra Deck Pendulum state after advancing out of Main Phase 1",
            phase: "battle",
            windowId: 1,
            windowKind: "open",
            locations: { extraDeck: ["100"] },
            cards: [{ uid: "p0-deck-100-0", code: "100", location: "extraDeck", faceUp: true, position: "faceDown" }],
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
        note: "EDOPro final fixture state keeps the Pendulum monster face-up in the Extra Deck",
        phase: "battle",
        windowId: 1,
        locations: { extraDeck: ["100"] },
        cards: [{ uid: "p0-deck-100-0", code: "100", location: "extraDeck", faceUp: true, position: "faceDown" }],
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
