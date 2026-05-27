import { describe, expect, it } from "vitest";
import { buildRealModelObservation, renderRealObservationJson } from "./realAgent.js";
import { initialRealReducedState } from "./normalizedEvents.js";
import type { RealScenario } from "./realScenario.js";

describe("buildRealModelObservation", () => {
  it("shows legal action labels without engine responses", () => {
    const state = initialRealReducedState();
    state.turn = 1;
    state.phase = "MAIN1";
    state.players[0].lp = 8000;
    state.players[0].handCount = 5;
    state.players[1].lp = 3000;
    state.players[1].handCount = 2;
    state.players[1].monsters.push({
      code: 89631139,
      name: "Blue-Eyes White Dragon",
      controller: 1,
      location: "MZONE",
      sequence: 0,
    });

    const observation = buildRealModelObservation({
      scenario: scenario(),
      state,
      prompt: { type: 0, player: 0 },
      promptTypeName: "SELECT_IDLECMD",
      legalActions: [
        {
          id: "a_001",
          type: "normal_summon",
          label: "Normal Summon Alexandrite Dragon",
          response: { hidden: true },
        },
      ],
      recentEvents: [
        {
          frame: 1,
          type: "event",
          event: "NEW_PHASE",
          turn: 1,
          phase: "MAIN1",
          text: "Phase changed to MAIN1.",
        },
      ],
    });

    const rendered = renderRealObservationJson(observation);
    expect(observation.legalActions).toEqual([
      {
        id: "a_001",
        type: "normal_summon",
        label: "Normal Summon Alexandrite Dragon",
      },
    ]);
    expect(rendered).not.toContain("hidden");
    expect(rendered).toContain("Blue-Eyes White Dragon");
    expect(observation.opponent.handCount).toBe(2);
  });
});

function scenario(): RealScenario {
  return {
    id: "real-smoke-duel",
    name: "Smoke Duel",
    seed: [1, 1, 1, 1],
    maxDecisions: 8,
    players: [
      {
        lp: 8000,
        startingDrawCount: 5,
        drawCountPerTurn: 1,
        deck: [89631139, 89631139, 89631139, 89631139, 89631139],
      },
      {
        lp: 8000,
        startingDrawCount: 5,
        drawCountPerTurn: 1,
        deck: [89631139, 89631139, 89631139, 89631139, 89631139],
      },
    ],
  };
}
