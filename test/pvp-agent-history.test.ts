import { describe, expect, it } from "vitest";
import { applyPvpAgentAction, observePvpAgent } from "../src/playtest-app/pvp-agent-api.js";
import { buildAgentHistoryEntry, compactHistoryForModel, diffAgentObservations } from "../src/playtest-app/pvp-agent-history.js";
import { bootstrapPvpDuel } from "../src/playtest-app/pvp-arena.js";
import type { DuelCardData } from "#duel/types.js";

const fixtureYdk = `#created by test
#main
100
200
#extra
!side`;

const cards: DuelCardData[] = [
  { code: "100", name: "History Monster", kind: "monster", attack: 1000, defense: 1000 },
  { code: "200", name: "History Trap", kind: "trap" },
];

describe("PvP agent history", () => {
  it("diffs a monster summon into a public move and log delta", () => {
    const session = duel();
    const before = observePvpAgent(session, 0);
    const summon = before.legalActions.find((action) => action.type === "normalSummon" && action.source?.name === "History Monster");
    expect(summon).toBeDefined();

    const result = applyPvpAgentAction(session, 0, summon!.id, { summonSequence: 4 });
    expect(result.ok).toBe(true);
    const deltas = diffAgentObservations(before, result.observation);

    expect(deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "move",
        name: "History Monster",
        from: expect.objectContaining({ location: "hand" }),
        to: expect.objectContaining({ location: "monsterZone", sequence: 4 }),
      }),
      expect.objectContaining({ type: "log", action: "normalSummon", card: "History Monster" }),
    ]));
  });

  it("builds history entries with action params, result, and chain depths", () => {
    const session = duel();
    const before = observePvpAgent(session, 0);
    const setTrap = before.legalActions.find((action) => action.type === "setSpellTrap" && action.source?.name === "History Trap");
    expect(setTrap).toBeDefined();
    const decision = { actionId: setTrap!.id, params: { spellTrapSequence: 3 } };

    const result = applyPvpAgentAction(session, 0, decision.actionId, decision.params);
    const after = result.observation;
    const entry = buildAgentHistoryEntry({ step: 0, before, after, action: setTrap, decision, result });

    expect(entry).toMatchObject({
      step: 0,
      turn: 1,
      phase: "main1",
      player: 0,
      actionId: setTrap!.id,
      actionType: "setSpellTrap",
      label: "Set History Trap",
      params: { spellTrapSequence: 3 },
      result: "ok",
      chainDepthBefore: 0,
      chainDepthAfter: 0,
    });
    expect(entry.publicDelta).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "move",
        name: "History Trap",
        to: expect.objectContaining({ location: "spellTrapZone", sequence: 3 }),
      }),
    ]));
  });

  it("compacts current turn and recent history without mutating originals", () => {
    const session = duel();
    const before = observePvpAgent(session, 0);
    const setTrap = before.legalActions.find((action) => action.type === "setSpellTrap" && action.source?.name === "History Trap")!;
    const decision = { actionId: setTrap.id, params: { spellTrapSequence: 2 } };
    const result = applyPvpAgentAction(session, 0, decision.actionId, decision.params);
    const entry = buildAgentHistoryEntry({ step: 0, before, after: result.observation, action: setTrap, decision, result });

    const compact = compactHistoryForModel({ history: [entry], player: 0, currentTurn: 1, recentLimit: 8 });

    expect(compact.currentTurn).toHaveLength(1);
    expect(compact.recent).toHaveLength(1);
    compact.recent[0]!.publicDelta.length = 0;
    expect(entry.publicDelta.length).toBeGreaterThan(0);
  });
});

function duel() {
  return bootstrapPvpDuel(fixtureYdk, fixtureYdk, "pvp-agent-history", 2, {
    cardReader: (code) => cards.find((card) => card.code === code),
  });
}
