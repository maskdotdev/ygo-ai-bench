import { describe, expect, it } from "vitest";
import { applyResponse, canSpecialSummonDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, restoreDuel, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
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

  it("restores Pendulum Summon legal actions and rejects stale restored responses", () => {
    const pendulumCards: DuelCardData[] = [
      { code: "100", name: "Low Restore Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "200", name: "High Restore Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
      { code: "300", name: "Restored Extra Pendulum", kind: "monster", typeFlags: 0x1000001, level: 4 },
    ];
    const session = createDuel({ seed: 252, startingHandSize: 3, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const low = session.state.cards.find((card) => card.code === "100");
    const high = session.state.cards.find((card) => card.code === "200");
    const candidate = session.state.cards.find((card) => card.code === "300");
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(candidate).toBeDefined();
    moveDuelCard(session.state, low!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, high!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, candidate!.uid, "monsterZone", 0);
    moveDuelCard(session.state, candidate!.uid, "extraDeck", 0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(pendulumCards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidateAction) => candidateAction.type === "pendulumSummon" && candidateAction.summonUids.includes(candidate!.uid));
    expect(action).toMatchObject({ type: "pendulumSummon", summonUids: [candidate!.uid], windowId: queryPublicState(restored).actionWindowId, windowKind: "open" });
    if (!action || action.type !== "pendulumSummon") throw new Error("Expected restored Pendulum Summon action");

    const result = applyResponse(restored, action);
    expect(result.ok).toBe(true);
    expect(restored.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum", faceUp: true });
    expect(restored.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    const staleResult = applyResponse(restored, action);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
  });
});
