import { describe, expect, it } from "vitest";
import {
  applyResponse,
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
import type { DuelCardData } from "#duel/types.js";
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

  it("consumes Pendulum Summon availability until the player's next turn", () => {
    const pendulumCards: DuelCardData[] = [
      { code: "101", name: "Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "102", name: "High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
      { code: "301", name: "First Pendulum", kind: "monster", typeFlags: 0x1000001, level: 4 },
      { code: "302", name: "Second Pendulum", kind: "monster", typeFlags: 0x1000001, level: 5 },
    ];
    const session = createDuel({ seed: 42, startingHandSize: 4, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, {
      0: { main: ["101", "102", "301", "302"] },
      1: { main: [] },
    });
    startDuel(session);

    const lowScale = session.state.cards.find((card) => card.code === "101");
    const highScale = session.state.cards.find((card) => card.code === "102");
    const firstPendulum = session.state.cards.find((card) => card.code === "301");
    const secondPendulum = session.state.cards.find((card) => card.code === "302");
    expect(lowScale).toBeTruthy();
    expect(highScale).toBeTruthy();
    expect(firstPendulum).toBeTruthy();
    expect(secondPendulum).toBeTruthy();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0).sequence = 1;

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "pendulumSummon");
    if (!action || action.type !== "pendulumSummon") throw new Error("Expected Pendulum Summon action");
    expect(action.summonUids).toHaveLength(2);
    expect(action.summonUids).toEqual(expect.arrayContaining([firstPendulum!.uid, secondPendulum!.uid]));

    const result = applyResponse(session, { ...action, summonUids: [firstPendulum!.uid] });

    expect(result.ok, result.error).toBe(true);
    expect(result.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(result.legalActions.some((candidate) => candidate.type === "pendulumSummon")).toBe(false);
    expect(session.state.cards.find((card) => card.uid === firstPendulum!.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum" });
    expect(session.state.cards.find((card) => card.uid === secondPendulum!.uid)).toMatchObject({ location: "hand" });
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
