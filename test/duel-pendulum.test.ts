import { describe, expect, it } from "vitest";
import {
  applyResponse,
  canMoveDuelCardToLocation,
  canSpecialSummonDuelCard,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  restoreDuel,
  serializeDuel,
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

  it("exposes every Pendulum Summon candidate even when monster zones limit the final selection", () => {
    const pendulumCards: DuelCardData[] = [
      { code: "101", name: "Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "102", name: "High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
      { code: "201", name: "Zone Blocker 1", kind: "monster", level: 4 },
      { code: "202", name: "Zone Blocker 2", kind: "monster", level: 4 },
      { code: "203", name: "Zone Blocker 3", kind: "monster", level: 4 },
      { code: "204", name: "Zone Blocker 4", kind: "monster", level: 4 },
      { code: "301", name: "First Candidate", kind: "monster", typeFlags: 0x1000001, level: 3 },
      { code: "302", name: "Second Candidate", kind: "monster", typeFlags: 0x1000001, level: 4 },
      { code: "303", name: "Third Candidate", kind: "monster", typeFlags: 0x1000001, level: 5 },
    ];
    const session = createDuel({ seed: 44, startingHandSize: 9, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, {
      0: { main: ["101", "102", "201", "202", "203", "204", "301", "302", "303"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["201", "202", "203", "204"]) {
      const blocker = session.state.cards.find((card) => card.code === code);
      expect(blocker).toBeTruthy();
      moveDuelCard(session.state, blocker!.uid, "monsterZone", 0);
    }
    const lowScale = session.state.cards.find((card) => card.code === "101");
    const highScale = session.state.cards.find((card) => card.code === "102");
    const first = session.state.cards.find((card) => card.code === "301");
    const second = session.state.cards.find((card) => card.code === "302");
    const third = session.state.cards.find((card) => card.code === "303");
    expect(lowScale).toBeTruthy();
    expect(highScale).toBeTruthy();
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(third).toBeTruthy();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0).sequence = 1;

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "pendulumSummon");
    if (!action || action.type !== "pendulumSummon") throw new Error("Expected Pendulum Summon action");
    expect(action.summonUids).toEqual([first!.uid, second!.uid, third!.uid]);
    expect(action.maxSummons).toBe(1);

    const tooMany = applyResponse(session, { ...action, summonUids: [first!.uid, second!.uid] });
    expect(tooMany.ok).toBe(false);
    expect(session.state.cards.find((card) => card.uid === first!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === second!.uid)).toMatchObject({ location: "hand" });

    const result = applyResponse(session, { ...action, summonUids: [third!.uid] });
    expect(result.ok, result.error).toBe(true);
    expect(session.state.cards.find((card) => card.uid === third!.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum" });
    expect(session.state.cards.find((card) => card.uid === first!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === second!.uid)).toMatchObject({ location: "hand" });
  });

  it("restores consumed Pendulum Summon availability on the player's next turn", () => {
    const pendulumCards: DuelCardData[] = [
      { code: "101", name: "Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "102", name: "High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
      { code: "301", name: "First Pendulum", kind: "monster", typeFlags: 0x1000001, level: 4 },
      { code: "302", name: "Second Pendulum", kind: "monster", typeFlags: 0x1000001, level: 5 },
      { code: "303", name: "Next Turn Draw", kind: "monster", level: 4 },
      { code: "304", name: "Second Next Turn Draw", kind: "monster", level: 4 },
      { code: "305", name: "Third Next Turn Draw", kind: "monster", level: 4 },
      { code: "401", name: "Opponent Draw One", kind: "monster", level: 4 },
      { code: "402", name: "Opponent Draw Two", kind: "monster", level: 4 },
    ];
    const cardReader = createCardReader(pendulumCards);
    const session = createDuel({ seed: 43, startingHandSize: 4, cardReader });
    loadDecks(session, {
      0: { main: ["101", "102", "301", "302", "303", "304", "305"] },
      1: { main: ["401", "402"] },
    });
    startDuel(session);

    const lowScale = session.state.cards.find((card) => card.code === "101");
    const highScale = session.state.cards.find((card) => card.code === "102");
    const firstPendulum = session.state.cards.find((card) => card.code === "301");
    expect(lowScale).toBeTruthy();
    expect(highScale).toBeTruthy();
    expect(firstPendulum).toBeTruthy();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, highScale!.uid, "spellTrapZone", 0).sequence = 1;
    if (firstPendulum!.location !== "hand") moveDuelCard(session.state, firstPendulum!.uid, "hand", 0);
    const secondPendulum = session.state.cards.find((card) => card.code === "302");
    expect(secondPendulum).toBeTruthy();
    if (secondPendulum!.location !== "hand") moveDuelCard(session.state, secondPendulum!.uid, "hand", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "pendulumSummon");
    if (!action || action.type !== "pendulumSummon") throw new Error("Expected Pendulum Summon action");
    expect(applyResponse(session, { ...action, summonUids: [firstPendulum!.uid] }).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), cardReader);
    expect(restored.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "pendulumSummon")).toBe(false);

    const playerEnd = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "endTurn");
    expect(playerEnd).toBeDefined();
    const playerEndResult = applyResponse(restored, playerEnd!);
    expect(playerEndResult.ok).toBe(true);
    expect(playerEndResult.legalActions).toEqual(getDuelLegalActions(restored, playerEndResult.state.waitingFor!));
    expect(playerEndResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, playerEndResult.state.waitingFor!));
    expect(playerEndResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(playerEndResult.legalActions);
    const opponentEnd = getDuelLegalActions(restored, 1).find((candidate) => candidate.type === "endTurn");
    expect(opponentEnd).toBeDefined();
    const opponentEndResult = applyResponse(restored, opponentEnd!);
    expect(opponentEndResult.ok).toBe(true);
    expect(opponentEndResult.legalActions).toEqual(getDuelLegalActions(restored, opponentEndResult.state.waitingFor!));
    expect(opponentEndResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, opponentEndResult.state.waitingFor!));
    expect(opponentEndResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(opponentEndResult.legalActions);

    expect(restored.state.players[0].pendulumSummonAvailable).toBe(true);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "pendulumSummon")).toBe(true);
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
