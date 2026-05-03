import { describe, expect, it } from "vitest";
import { canSpecialSummonDuelCard, createDuel, loadDecks, queryPublicState, restoreDuel, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("pendulum restore", () => {
  it("restores face-up extra deck pendulum state and direct special summon legality", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["350"], extra: ["980"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const pendulum = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "350");
    const extra = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    expect(pendulum).toBeTruthy();
    expect(extra).toBeTruthy();
    moveDuelCard(session.state, pendulum!.uid, "extraDeck", 0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "extraDeck", faceUp: true, position: "faceDown" });
    expect(restored.state.cards.find((card) => card.uid === extra!.uid)).toMatchObject({ location: "extraDeck", faceUp: false, position: "faceDown" });
    expect(canSpecialSummonDuelCard(restored.state, pendulum!.uid, 0)).toBe(true);
    expect(canSpecialSummonDuelCard(restored.state, extra!.uid, 0)).toBe(false);
    expect(() => specialSummonDuelCard(restored.state, extra!.uid, 0)).toThrow("cannot be Special Summoned");

    const summoned = specialSummonDuelCard(restored.state, pendulum!.uid, 0);
    expect(summoned).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack", summonType: "special" });
    expect(restored.state.log.some((entry) => entry.action === "specialSummon" && entry.card === "Pendulum Test Monster")).toBe(true);
  });
});
