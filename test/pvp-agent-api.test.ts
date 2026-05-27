import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyPvpAgentAction, firstLegalPvpAgentPolicy, observePvpAgent, replayPvpAgentActions, runPvpAgentLoop } from "../src/playtest-app/pvp-agent-api.js";
import { bootstrapPvpDuel } from "../src/playtest-app/pvp-arena.js";
import type { DuelCardData } from "#duel/types.js";

const fixtureYdk = `#created by test
#main
100
200
300
#extra
!side`;

const cards: DuelCardData[] = [
  { code: "100", name: "Agent Monster", kind: "monster", attack: 1000, defense: 1000 },
  { code: "200", name: "Agent Trap", kind: "trap" },
  { code: "300", name: "Agent Field", kind: "spell", typeFlags: 0x80000 },
];

describe("PvP agent API", () => {
  it("observes normalized public zones and stable legal action ids", () => {
    const session = duel();

    const observation = observePvpAgent(session, 0);

    expect(observation.zones.self.hand.map((card) => card.name).sort()).toEqual(["Agent Field", "Agent Monster", "Agent Trap"]);
    expect(observation.zones.self.monsterZone).toHaveLength(5);
    expect(observation.zones.self.spellTrapZone).toHaveLength(5);
    expect(observation.legalActions.length).toBeGreaterThan(0);
    expect(observation.legalActions.every((action) => action.id.length > 0)).toBe(true);
    expect(new Set(observation.legalActions.map((action) => action.id)).size).toBe(observation.legalActions.length);
  });

  it("applies a monster summon by action id with a requested zone", () => {
    const session = duel();
    const observation = observePvpAgent(session, 0);
    const summon = observation.legalActions.find((action) => action.type === "normalSummon" && action.source?.name === "Agent Monster");
    expect(summon).toBeDefined();
    expect(summon?.placement).toMatchObject({ kind: "monsterZone", required: true, allowedSequences: [0, 1, 2, 3, 4] });

    const result = applyPvpAgentAction(session, 0, summon!.id, { summonSequence: 4 });

    expect(result.ok).toBe(true);
    expect(session.state.cards.find((card) => card.code === "100" && card.owner === 0)).toMatchObject({
      location: "monsterZone",
      sequence: 4,
    });
  });

  it("requires placement params for placement-aware actions", () => {
    const session = duel();
    const observation = observePvpAgent(session, 0);
    const summon = observation.legalActions.find((action) => action.type === "normalSummon" && action.source?.name === "Agent Monster");
    expect(summon).toBeDefined();

    const result = applyPvpAgentAction(session, 0, summon!.id);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("requires summonSequence");
  });

  it("sets a spell/trap by action id with a requested zone and rejects occupied choices", () => {
    const session = duel();
    const filler = session.state.cards.find((card) => card.code === "100" && card.owner === 0)!;
    moveDuelCard(session.state, filler.uid, "spellTrapZone", 0).sequence = 0;
    const observation = observePvpAgent(session, 0);
    const setTrap = observation.legalActions.find((action) => action.type === "setSpellTrap" && action.source?.name === "Agent Trap");
    expect(setTrap).toBeDefined();
    expect(setTrap?.placement).toMatchObject({ kind: "spellTrapZone", required: true, allowedSequences: [1, 2, 3, 4] });

    const occupied = applyPvpAgentAction(session, 0, setTrap!.id, { spellTrapSequence: 0 });
    expect(occupied.ok).toBe(false);
    expect(occupied.error).toContain("spellTrapSequence 0 is not legal");

    const placed = applyPvpAgentAction(session, 0, setTrap!.id, { spellTrapSequence: 3 });
    expect(placed.ok).toBe(true);
    expect(session.state.cards.find((card) => card.code === "200" && card.owner === 0)).toMatchObject({
      location: "spellTrapZone",
      sequence: 3,
    });
  });

  it("reports Field Spells as Field Zone actions without requiring S/T placement", () => {
    const session = duel();
    const observation = observePvpAgent(session, 0);
    const setField = observation.legalActions.find((action) => action.type === "setSpellTrap" && action.source?.name === "Agent Field");

    expect(setField).toBeDefined();
    expect(setField?.placement).toEqual({ kind: "fieldZone", player: 0, allowedSequences: [5], required: false });
  });

  it("replays agent action ids deterministically", () => {
    const session = duel();
    const observation = observePvpAgent(session, 0);
    const setTrap = observation.legalActions.find((action) => action.type === "setSpellTrap" && action.source?.name === "Agent Trap");
    expect(setTrap).toBeDefined();

    const result = replayPvpAgentActions(session, [
      { player: 0, actionId: setTrap!.id, params: { spellTrapSequence: 2 } },
    ]);

    expect(result.ok).toBe(true);
    expect(result.appliedActions).toHaveLength(1);
    expect(session.state.cards.find((card) => card.code === "200" && card.owner === 0)).toMatchObject({
      location: "spellTrapZone",
      sequence: 2,
    });
  });

  it("can run a simple policy through the agent loop", async () => {
    const session = duel();

    const result = await runPvpAgentLoop(session, { 0: firstLegalPvpAgentPolicy, 1: firstLegalPvpAgentPolicy }, { maxSteps: 1 });

    expect(result.steps).toHaveLength(1);
    expect(session.state.cards.some((card) => card.location !== "hand" && card.owner === 0)).toBe(true);
  });
});

function duel() {
  return bootstrapPvpDuel(fixtureYdk, fixtureYdk, "pvp-agent-api", 3, {
    cardReader: (code) => cards.find((card) => card.code === code),
  });
}
