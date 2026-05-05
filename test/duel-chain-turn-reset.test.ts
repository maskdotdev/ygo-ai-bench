import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel chain turn reset", () => {
  it("resets once-per-turn effect usage on a later turn", () => {
    const session = createDuel({ seed: 3, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "repeat-next-turn",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["monsterZone"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.log(`Resolved on turn ${ctx.duel.turn}`);
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === source!.uid);
    expect(summon).toBeTruthy();
    applyAndAssert(session, summon!);

    const firstActivation = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "repeat-next-turn");
    expect(firstActivation).toBeTruthy();
    applyAndAssert(session, firstActivation!);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "repeat-next-turn")).toBe(false);

    const playerEnd = getDuelLegalActions(session, 0).find((action) => action.type === "endTurn");
    expect(playerEnd).toBeTruthy();
    applyAndAssert(session, playerEnd!);
    const opponentEnd = getDuelLegalActions(session, 1).find((action) => action.type === "endTurn");
    expect(opponentEnd).toBeTruthy();
    applyAndAssert(session, opponentEnd!);

    expect(queryPublicState(session).turn).toBe(3);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "repeat-next-turn")).toBe(true);
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
