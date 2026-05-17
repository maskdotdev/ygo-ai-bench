import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { runScriptedDuelFixture } from "#engine/parity.js";

describe("EDOPro compatibility harness life point validation", () => {
  it("rejects malformed setup effect life point operations", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const result = runScriptedDuelFixture({
      name: "malformed setup effect life point fixture",
      options: { seed: 69, startingHandSize: 1 },
      decks: {
        0: { main: ["100"] },
        1: { main: ["200"] },
      },
      setup: {
        effects: [{
          id: "effect",
          player: 0,
          code: "100",
          event: "ignition",
          range: ["hand"],
          damagePlayerOnResolve: [
            "damage" as never,
            {
              player: 2,
              amount: 0,
              eventIsLast: "yes",
              eventReason: 1.5,
              eventReasonPlayer: -1,
              eventReasonCardUid: 9,
              eventReasonEffectId: Number.POSITIVE_INFINITY,
              relatedEffectId: Number.NaN,
              eventChainDepth: -0.5,
              eventChainLinkId: 9,
              typo: true,
            } as never,
          ],
          recoverPlayerOnResolve: [
            {
              player: -1,
              amount: -1,
            } as never,
          ],
        }],
      },
      responses: [],
      expected: { source: "edopro" },
    }, {
      cardReader: createCardReader(cards),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect damagePlayerOnResolve[0] has malformed value damage" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect damagePlayerOnResolve[1].player has malformed player 2" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect damagePlayerOnResolve[1].amount has malformed value 0" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect damagePlayerOnResolve[1].eventIsLast has malformed value yes" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect damagePlayerOnResolve[1].eventReason has malformed value 1.5" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect damagePlayerOnResolve[1].eventReasonPlayer has malformed player -1" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect damagePlayerOnResolve[1].eventReasonCardUid has malformed value 9" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect damagePlayerOnResolve[1].eventReasonEffectId has malformed value Infinity" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect damagePlayerOnResolve[1].relatedEffectId has malformed value NaN" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect damagePlayerOnResolve[1].eventChainDepth has malformed value -0.5" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect damagePlayerOnResolve[1].eventChainLinkId has malformed value 9" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect damagePlayerOnResolve[1] has malformed key typo" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect recoverPlayerOnResolve[0].player has malformed player -1" },
      { fixture: "malformed setup effect life point fixture", message: "Setup effect effect recoverPlayerOnResolve[0].amount has malformed value -1" },
    ]);
  });
});
