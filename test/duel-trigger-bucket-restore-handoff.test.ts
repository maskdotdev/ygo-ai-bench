import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("trigger bucket restore handoff", () => {
  it("returns restored opponent optional declines to turn-player open priority", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "100", "100"] },
    });
    startDuel(session);
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const turnQuickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const opponentTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(summoned).toBeTruthy();
    expect(turnTriggerSource).toBeTruthy();
    expect(turnQuickSource).toBeTruthy();
    expect(opponentTriggerSource).toBeTruthy();
    registerEffect(session, normalSummonTrigger("restore-turn-optional-decline", turnTriggerSource!.uid, 0, "Restored turn optional trigger resolved"));
    registerEffect(session, normalSummonTrigger("restore-opponent-optional-decline", opponentTriggerSource!.uid, 1, "Restored opponent optional trigger resolved"));
    registerEffect(session, openOnlyQuickEffect("restore-open-priority-after-opponent-decline", turnQuickSource!.uid, 0, "Restored open priority after opponent decline resolved"));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-turn-optional-decline", "restore-opponent-optional-decline"]);

    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    const turnDecline = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-turn-optional-decline");
    expect(turnDecline).toBeDefined();
    applyAndAssert(restoredTurnBucket, turnDecline!);
    expect(restoredTurnBucket.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-opponent-optional-decline"]);
    expect(restoredTurnBucket.state.waitingFor).toBe(1);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentBucket)).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    expect(getDuelLegalActions(restoredOpponentBucket, 0)).toEqual([]);
    const opponentDecline = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "declineTrigger" && action.effectId === "restore-opponent-optional-decline");
    expect(opponentDecline).toBeDefined();
    const staleBeforeDecline = applyResponse(restoredOpponentBucket, { ...opponentDecline!, windowId: opponentDecline!.windowId! - 1 });
    expect(staleBeforeDecline.ok).toBe(false);
    expect(staleBeforeDecline.error).toContain("Response is not currently legal");
    expect(staleBeforeDecline.state.actionWindowId).toBe(restoredOpponentBucket.state.actionWindowId);
    expect(staleBeforeDecline.legalActions).toEqual(getDuelLegalActions(restoredOpponentBucket, 1));
    expect(staleBeforeDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentBucket, 1));
    expect(staleBeforeDecline.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeDecline.legalActions);

    const declined = applyAndAssert(restoredOpponentBucket, opponentDecline!);
    expect(declined.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(declined.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, effectId: "restore-open-priority-after-opponent-decline", windowKind: "open" })]));
    expect(restoredOpponentBucket.state.log.some((entry) => entry.action === "declineTrigger" && entry.detail === "restore-opponent-optional-decline")).toBe(true);
    expect(restoredOpponentBucket.state.log.some((entry) => entry.detail === "Restored opponent optional trigger resolved")).toBe(false);
    expect(getDuelLegalActions(restoredOpponentBucket, 1)).toEqual([]);
    const staleDecline = applyResponse(restoredOpponentBucket, opponentDecline!);
    expect(staleDecline.ok).toBe(false);
    expect(staleDecline.error).toContain("Response is not currently legal");
    expect(staleDecline.state.actionWindowId).toBe(restoredOpponentBucket.state.actionWindowId);
    expect(staleDecline.legalActions).toEqual(getDuelLegalActions(restoredOpponentBucket, 0));
    expect(staleDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentBucket, 0));
    expect(staleDecline.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleDecline.legalActions);
  });
});

function normalSummonTrigger(id: string, sourceUid: string, controller: 0 | 1, detail: string): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "trigger",
    triggerEvent: "normalSummoned",
    range: ["hand"],
    operation(ctx) {
      ctx.log(detail);
    },
  };
}

function openOnlyQuickEffect(id: string, sourceUid: string, controller: 0 | 1, detail: string): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "quick",
    range: ["hand"],
    operation(ctx) {
      ctx.log(detail);
    },
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-turn-optional-decline": restoreLoggedEffect("Restored turn optional trigger resolved"),
    "restore-opponent-optional-decline": restoreLoggedEffect("Restored opponent optional trigger resolved"),
    "restore-open-priority-after-opponent-decline": (effect) => ({
      ...restoreLoggedEffect("Restored open priority after opponent decline resolved")(effect),
      canActivate(ctx) {
        return ctx.duel.chain.length === 0;
      },
    }),
  };
}

function restoreLoggedEffect(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...effect,
    operation(ctx) {
      ctx.log(detail);
    },
  });
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
