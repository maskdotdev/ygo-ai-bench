import { describe, expect, it } from "vitest";
import {
  emptyAgentMemory,
  legalActionsForModel,
  memoryUpdatingModelClient,
  placementAwareModelClient,
  runPvpModelMatch,
  validateModelDecision,
  type PvpModelClient,
  type PvpModelTurnInput,
} from "../src/playtest-app/pvp-model-agent.js";
import { observePvpAgent } from "../src/playtest-app/pvp-agent-api.js";
import { bootstrapPvpDuel } from "../src/playtest-app/pvp-arena.js";
import type { DuelCardData } from "#duel/types.js";

const fixtureYdk = `#created by test
#main
100
200
#extra
!side`;

const cards: DuelCardData[] = [
  { code: "100", name: "Model Monster", kind: "monster", attack: 1000, defense: 1000 },
  { code: "200", name: "Model Trap", kind: "trap" },
];

describe("PvP model agent runner", () => {
  it("passes history from the previous model step into the next model call", async () => {
    const session = duel();
    const calls: PvpModelTurnInput[] = [];
    const client: PvpModelClient = {
      async chooseAction(input) {
        calls.push(input);
        const action = input.legalActions.find((candidate) => candidate.type === "setSpellTrap") ?? input.legalActions[0]!;
        const firstSequence = action.placement?.allowedSequences[0];
        const params = firstSequence === undefined
          ? undefined
          : action.placement?.kind === "spellTrapZone"
            ? { spellTrapSequence: firstSequence }
            : action.placement?.kind === "monsterZone"
              ? { summonSequence: firstSequence }
              : undefined;
        return {
          actionId: action.id,
          ...(params === undefined ? {} : { params }),
          memory: input.memory,
          reason: "test",
        };
      },
    };

    const result = await runPvpModelMatch({ session, agents: { 0: client, 1: placementAwareModelClient }, maxSteps: 2 });

    expect(result.history).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.history.recent).toHaveLength(1);
    expect(calls[1]!.history.recent[0]!.label).toContain("Model");
  });

  it("persists model memory per player", async () => {
    const session = duel();

    const result = await runPvpModelMatch({
      session,
      agents: {
        0: memoryUpdatingModelClient({ plan: "set up board", goals: ["resolve trap"] }),
        1: placementAwareModelClient,
      },
      maxSteps: 1,
    });

    expect(result.memories[0]).toMatchObject({ plan: "set up board", goals: ["resolve trap"] });
    expect(result.memories[1]).toEqual(emptyAgentMemory());
  });

  it("validates missing placement params before engine apply", () => {
    const session = duel();
    const observation = observePvpAgent(session, 0);
    const summon = observation.legalActions.find((action) => action.type === "normalSummon");
    expect(summon).toBeDefined();

    const result = validateModelDecision(observation, {
      actionId: summon!.id,
      memory: emptyAgentMemory(),
      reason: "missing placement",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("requires summonSequence");
  });

  it("rejects invented action ids", () => {
    const session = duel();
    const observation = observePvpAgent(session, 0);

    const result = validateModelDecision(observation, {
      actionId: "invented",
      memory: emptyAgentMemory(),
      reason: "bad",
    });

    expect(result).toEqual({ ok: false, error: "Model selected non-legal actionId invented" });
  });

  it("creates compact legal action views without raw engine actions", () => {
    const session = duel();
    const observation = observePvpAgent(session, 0);

    const legal = legalActionsForModel(observation);

    expect(legal.length).toBeGreaterThan(0);
    expect(legal[0]).not.toHaveProperty("raw");
    expect(legal.some((action) => action.placement?.required)).toBe(true);
  });
});

function duel() {
  return bootstrapPvpDuel(fixtureYdk, fixtureYdk, "pvp-model-agent", 2, {
    cardReader: (code) => cards.find((card) => card.code === code),
  });
}
