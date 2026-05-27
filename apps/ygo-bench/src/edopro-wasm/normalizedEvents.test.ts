import { describe, expect, it } from "vitest";
import type { CardDatabase } from "./cardDb.js";
import { initialRealReducedState, normalizeMessages } from "./normalizedEvents.js";
import type { OcgRuntime } from "./ocgTypes.js";

describe("normalizeMessages", () => {
  it("updates phase, hand counts, zones, and winner from real ocg messages", () => {
    const state = initialRealReducedState();
    state.players[0].deckCount = 2;
    state.players[0].extraDeckCount = 1;
    let frame = 0;

    const events = normalizeMessages({
      messages: [
        { type: 40, player: 0 },
        { type: 41, phase: 4 },
        { type: 90, player: 0, drawn: [{ code: 49003308, position: 10 }] },
        {
          type: 50,
          card: 49003308,
          from: { controller: 0, location: 2, sequence: 0, position: 10 },
          to: { controller: 0, location: 4, sequence: 2, position: 1 },
        },
        {
          type: 50,
          card: 49003308,
          from: { controller: 0, location: 64, sequence: 0, position: 8 },
          to: { controller: 0, location: 16, sequence: 0, position: 1 },
        },
        { type: 91, player: 1, amount: 1850 },
        { type: 5, player: 0, reason: 0 },
      ],
      ocg: testRuntime,
      cardDb: testCards,
      state,
      nextFrame: () => {
        frame += 1;
        return frame;
      },
    });

    expect(events.map((event) => event.event)).toEqual(["NEW_TURN", "NEW_PHASE", "DRAW", "CARD_MOVED", "CARD_MOVED", "DAMAGE", "WIN"]);
    expect(state.turn).toBe(1);
    expect(state.phase).toBe("MAIN1");
    expect(state.players[0].handCount).toBe(0);
    expect(state.players[0].hand).toEqual([]);
    expect(state.players[0].deckCount).toBe(1);
    expect(state.players[0].extraDeckCount).toBe(0);
    expect(state.players[0].monsters).toEqual([
      {
        code: 49003308,
        name: "Gagagigo",
        controller: 0,
        location: "MZONE",
        sequence: 2,
        position: 1,
      },
    ]);
    expect(state.players[1].lp).toBe(6150);
    expect(state.winner).toBe(0);
  });
});

const testCards: CardDatabase = {
  cards: new Map(),
  names: new Map([[49003308, "Gagagigo"]]),
};

const testRuntime = {
  OcgMessageType: {
    WIN: 5,
    NEW_TURN: 40,
    NEW_PHASE: 41,
    MOVE: 50,
    DRAW: 90,
    DAMAGE: 91,
  },
} as OcgRuntime;
