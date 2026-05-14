import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, restoreDuel, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot battle window numeric validation", () => {
  it("rejects impossible battle window ids before restore", () => {
    const session = createDuel({ seed: 254, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["400"] } });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    applyAndAssert(session, getLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid)!);

    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    const unsafe = serializeDuel(session);
    negative.state.battleWindow = { ...negative.state.battleWindow!, id: -1 };
    fractional.state.battleWindow = { ...fractional.state.battleWindow!, id: 1.5 };
    unsafe.state.battleWindow = { ...unsafe.state.battleWindow!, id: Number.MAX_SAFE_INTEGER + 1 };

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.id must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.id must be a non-negative integer");
    expect(() => restoreDuel(unsafe, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.id must be a safe integer");
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
