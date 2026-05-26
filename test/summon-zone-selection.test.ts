import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import type { DuelCardData } from "#duel/types.js";

describe("summon zone selection", () => {
  it("summons to the requested open monster zone instead of the first open slot", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Zone Selector", kind: "monster", attack: 1000, defense: 1000 },
      { code: "200", name: "Occupied", kind: "monster", attack: 1000, defense: 1000 },
    ];
    const session = createDuel({
      seed: "summon-zone-selection",
      startingHandSize: 2,
      cardReader: (code) => cards.find((card) => card.code === code),
    });

    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["200"] } });
    startDuel(session);
    moveDuelCard(session.state, session.state.cards.find((card) => card.code === "200" && card.owner === 0)!.uid, "monsterZone", 0).sequence = 0;

    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid.includes("100"));
    expect(action).toBeDefined();

    const result = applyResponse(session, { ...action!, summonSequence: 3 });

    expect(result.ok).toBe(true);
    expect(session.state.cards.find((card) => card.code === "100" && card.owner === 0)).toMatchObject({
      location: "monsterZone",
      sequence: 3,
    });
  });
});
