import { describe, expect, it } from "vitest";
import { validateRealScenario, type RealScenario } from "./realScenario.js";

describe("validateRealScenario", () => {
  it("accepts a deck-driven real scenario", () => {
    expect(() => validateRealScenario(validScenario())).not.toThrow();
  });

  it("rejects an all-zero seed", () => {
    const scenario = validScenario();
    scenario.seed = [0, 0, 0, 0];
    expect(() => validateRealScenario(scenario)).toThrow(/seed/);
  });

  it("rejects decks smaller than starting draw count", () => {
    const scenario = validScenario();
    scenario.players[0].deck = [49003308];
    scenario.players[0].startingDrawCount = 2;
    expect(() => validateRealScenario(scenario)).toThrow(/deck is smaller/);
  });
});

function validScenario(): RealScenario {
  return {
    id: "real-test",
    name: "Real test",
    family: "smoke",
    version: "1.0.0",
    seed: [1, 1, 1, 1],
    maxDecisions: 4,
    players: [
      {
        lp: 8000,
        startingDrawCount: 1,
        drawCountPerTurn: 1,
        deck: [49003308, 89631139],
      },
      {
        lp: 8000,
        startingDrawCount: 1,
        drawCountPerTurn: 1,
        deck: [49003308, 89631139],
      },
    ],
  };
}
