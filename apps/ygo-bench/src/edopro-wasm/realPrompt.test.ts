import { describe, expect, it } from "vitest";
import { stringifyRealPrompt, type RealPromptResult } from "./realPrompt.js";

describe("stringifyRealPrompt", () => {
  it("omits hidden engine responses from prompt output", () => {
    const output = stringifyRealPrompt({
      scenarioId: "real-smoke-duel",
      prompt: {
        type: "SELECT_IDLECMD",
        player: 0,
        raw: { type: 11, player: 0 },
      },
      state: {
        turn: 1,
        phase: "MAIN1",
        winner: null,
        players: [
          { lp: 8000, handCount: 5, monsters: [], spellsTraps: [], graveyard: [], banished: [], deckCount: 3 },
          { lp: 8000, handCount: 5, monsters: [], spellsTraps: [], graveyard: [], banished: [], deckCount: 3 },
        ],
      },
      legalActions: [
        {
          id: "a_001",
          type: "normal_summon",
          label: "Normal Summon Gagagigo",
        },
      ],
    } satisfies RealPromptResult);

    expect(output).toContain("SELECT_IDLECMD");
    expect(output).toContain("Normal Summon Gagagigo");
    expect(output).not.toContain("response");
  });
});
