import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  sendDuelCardToGraveyard,
  startDuel,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel rollback", () => {
  it("rolls back chain operation failures", () => {
    const session = createDuel({ seed: 84, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const moved = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(moved).toBeTruthy();

    registerEffect(session, {
      id: "failing-operation",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, moved!.uid, ctx.player);
        throw new Error("operation failed");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "failing-operation");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("operation failed");
    expect(session.state.cards.find((card) => card.uid === source!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === moved!.uid)?.location).toBe("hand");
    expect(session.state.chain).toHaveLength(0);
    expect(session.state.status).toBe("awaiting");
  });

  it("rolls back failed activation costs", () => {
    const session = createDuel({ seed: 82, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const costCard = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(costCard).toBeTruthy();

    registerEffect(session, {
      id: "failed-cost",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      cost(ctx) {
        if (ctx.checkOnly) return true;
        sendDuelCardToGraveyard(ctx.duel, costCard!.uid, ctx.player, duelReason.cost);
        return false;
      },
      operation(ctx) {
        ctx.log("should not resolve");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "failed-cost");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Cost for failed-cost could not be paid");
    expect(session.state.cards.find((card) => card.uid === source!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === costCard!.uid)?.location).toBe("hand");
    expect(session.state.chain).toHaveLength(0);
  });
});
