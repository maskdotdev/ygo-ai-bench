import { describe, expect, test } from "vitest";
import { cardDataPathFromEnv, scriptRootFromEnv } from "../edopro-wasm/realDefaults.js";
import { InteractiveDuelSession } from "./PlaySession.js";

describe("InteractiveDuelSession", () => {
  test("pauses at a human prompt with public legal actions only", async () => {
    const session = await InteractiveDuelSession.create({
      id: "test-play-session",
      scenarioPath: "scenarios/real/smoke-duel.json",
      humanPlayer: 0,
      opponentAgent: "greedy",
      cardDataPath: cardDataPathFromEnv(),
      scriptRoot: scriptRootFromEnv(),
      maxDecisions: 8,
    });
    try {
      const view = session.view();
      expect(view.status).toBe("waiting_for_human");
      expect(view.currentPrompt?.player).toBe(0);
      expect(view.legalActions.length).toBeGreaterThan(0);
      expect(JSON.stringify(view.legalActions)).not.toContain("response");
      expect(view.reducedState.players[1].hand).toEqual([]);
    } finally {
      session.destroy();
    }
  });

  test("rejects invalid human actions without clearing the prompt", async () => {
    const session = await InteractiveDuelSession.create({
      id: "test-invalid-action",
      scenarioPath: "scenarios/real/smoke-duel.json",
      humanPlayer: 0,
      opponentAgent: "greedy",
      cardDataPath: cardDataPathFromEnv(),
      scriptRoot: scriptRootFromEnv(),
      maxDecisions: 8,
    });
    try {
      await expect(session.submitHumanAction("missing")).rejects.toThrow("Illegal action id");
      expect(session.view().status).toBe("waiting_for_human");
      expect(session.view().legalActions.length).toBeGreaterThan(0);
    } finally {
      session.destroy();
    }
  });
});
