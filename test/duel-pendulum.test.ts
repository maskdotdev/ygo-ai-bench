import { describe, expect, it } from "vitest";
import {
  canMoveDuelCardToLocation,
  canSpecialSummonDuelCard,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  specialSummonDuelCard,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel pendulum summons", () => {
  it("exposes normal summon and set actions for pendulum monsters in hand", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["350"], extra: [] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const pendulum = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "350");
    expect(pendulum).toBeTruthy();

    const legal = getDuelLegalActions(session, 0);
    expect(legal.some((action) => action.type === "normalSummon" && action.uid === pendulum!.uid)).toBe(true);
    expect(legal.some((action) => action.type === "setMonster" && action.uid === pendulum!.uid)).toBe(true);
  });

  it("moves pendulum monsters to the extra deck face-up", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["350", "100"], extra: ["980"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const pendulum = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "350");
    const normal = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const extra = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    expect(pendulum).toBeTruthy();
    expect(normal).toBeTruthy();
    expect(extra).toBeTruthy();

    moveDuelCard(session.state, pendulum!.uid, "monsterZone", 0);
    moveDuelCard(session.state, pendulum!.uid, "extraDeck", 0);
    moveDuelCard(session.state, extra!.uid, "graveyard", 0);
    moveDuelCard(session.state, extra!.uid, "extraDeck", 0);

    const state = queryPublicState(session);
    expect(canMoveDuelCardToLocation(session.state, normal!.uid, "extraDeck")).toBe(false);
    expect(state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "extraDeck", faceUp: true, position: "faceDown" });
    expect(state.cards.find((card) => card.uid === extra!.uid)).toMatchObject({ location: "extraDeck", faceUp: false, position: "faceDown" });
  });

  it("special summons face-up pendulum monsters from the extra deck", () => {
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

    expect(canSpecialSummonDuelCard(session.state, pendulum!.uid, 0)).toBe(true);
    expect(canSpecialSummonDuelCard(session.state, extra!.uid, 0)).toBe(false);
    expect(() => specialSummonDuelCard(session.state, extra!.uid, 0)).toThrow("cannot be Special Summoned");
    const summoned = specialSummonDuelCard(session.state, pendulum!.uid, 0);

    expect(summoned).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack", summonType: "special" });
    expect(session.state.log.some((entry) => entry.action === "specialSummon" && entry.card === "Pendulum Test Monster")).toBe(true);
  });

  it("hides normal summon actions when the monster zone is full", () => {
    const session = createDuel({ seed: 1, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "300", "300", "300", "500"] },
      1: { main: ["400", "400", "400", "400", "400", "400"] },
    });
    startDuel(session);

    const handMonsters = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster");
    for (const card of handMonsters.slice(0, 5)) moveDuelCard(session.state, card.uid, "monsterZone", 0);

    const legal = getDuelLegalActions(session, 0);
    expect(legal.some((action) => action.type === "normalSummon")).toBe(false);
    expect(() => specialSummonDuelCard(session.state, handMonsters[5]!.uid, 0)).toThrow("monsterZone is full");
  });
});
