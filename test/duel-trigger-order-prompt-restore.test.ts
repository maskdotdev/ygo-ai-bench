import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("trigger order prompt restore", () => {
  it("restores same-bucket optional order prompts and clears them after a decline", () => {
    const session = createPromptSession();
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(firstTriggerSource).toBeTruthy();
    expect(secondTriggerSource).toBeTruthy();
    registerEffect(session, normalSummonTrigger("restore-order-first-optional", firstTriggerSource!.uid, "Restored order first optional resolved"));
    registerEffect(session, normalSummonTrigger("restore-order-second-optional", secondTriggerSource!.uid, "Restored order second optional resolved"));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid)!);
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    const prompt = queryPublicState(restored).triggerOrderPrompt;
    expect(prompt).toEqual({
      id: `${restored.state.actionWindowId}:turnOptional:0`,
      type: "orderTriggers",
      player: 0,
      triggerBucket: "turnOptional",
      triggerIds: restored.state.pendingTriggers.map((trigger) => trigger.id),
    });
    expect(getGroupedDuelLegalActions(restored, 0).map((group) => group.triggerBucket?.triggerIds)).toEqual([prompt!.triggerIds, prompt!.triggerIds]);

    const decline = getDuelLegalActions(restored, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-order-first-optional");
    expect(decline).toBeDefined();
    const declined = applyAndAssert(restored, decline!);
    expect(declined.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-order-second-optional"]);
    expect(queryPublicState(restored).triggerOrderPrompt).toBeUndefined();
    expect(getDuelLegalActions(restored, 0).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual([
      "restore-order-second-optional",
      "restore-order-second-optional",
    ]);

    const restoredSingleTrigger = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredSingleTrigger).triggerOrderPrompt).toBeUndefined();
    expect(restoredSingleTrigger.state.pendingTriggers).toEqual(restored.state.pendingTriggers);
    const staleDecline = applyResponse(restoredSingleTrigger, decline!);
    expect(staleDecline.ok).toBe(false);
    expect(staleDecline.error).toContain("Response is not currently legal");
    expect(staleDecline.state.actionWindowId).toBe(restoredSingleTrigger.state.actionWindowId);
    expect(staleDecline.legalActions).toEqual(getDuelLegalActions(restoredSingleTrigger, 0));
    expect(staleDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredSingleTrigger, 0));
    expect(staleDecline.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleDecline.legalActions);
  });

  it("restores same-bucket mandatory order prompts and clears them after activation", () => {
    const session = createPromptSession();
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(firstTriggerSource).toBeTruthy();
    expect(secondTriggerSource).toBeTruthy();
    registerEffect(session, normalSummonTrigger("restore-order-first-mandatory", firstTriggerSource!.uid, "Restored order first mandatory resolved", false));
    registerEffect(session, normalSummonTrigger("restore-order-second-mandatory", secondTriggerSource!.uid, "Restored order second mandatory resolved", false));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid)!);
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreMandatoryRegistry());
    const prompt = queryPublicState(restored).triggerOrderPrompt;
    expect(prompt).toEqual({
      id: `${restored.state.actionWindowId}:turnMandatory:0`,
      type: "orderTriggers",
      player: 0,
      triggerBucket: "turnMandatory",
      triggerIds: restored.state.pendingTriggers.map((trigger) => trigger.id),
    });
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "declineTrigger")).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 0).map((group) => group.triggerBucket?.triggerIds)).toEqual([prompt!.triggerIds]);

    const activation = getDuelLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-order-first-mandatory");
    expect(activation).toBeDefined();
    const activated = applyAndAssert(restored, activation!);
    expect(activated.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-order-second-mandatory"]);
    expect(queryPublicState(restored).triggerOrderPrompt).toBeUndefined();
    expect(getDuelLegalActions(restored, 0).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual(["restore-order-second-mandatory"]);

    const restoredSingleTrigger = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreMandatoryRegistry());
    expect(queryPublicState(restoredSingleTrigger).triggerOrderPrompt).toBeUndefined();
    expect(restoredSingleTrigger.state.pendingTriggers).toEqual(restored.state.pendingTriggers);
    const staleActivation = applyResponse(restoredSingleTrigger, activation!);
    expect(staleActivation.ok).toBe(false);
    expect(staleActivation.error).toContain("Response is not currently legal");
    expect(staleActivation.state.actionWindowId).toBe(restoredSingleTrigger.state.actionWindowId);
    expect(staleActivation.legalActions).toEqual(getDuelLegalActions(restoredSingleTrigger, 0));
    expect(staleActivation.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredSingleTrigger, 0));
    expect(staleActivation.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleActivation.legalActions);
  });
});

function createPromptSession() {
  const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100", "300", "500"] },
    1: { main: ["400", "100", "100"] },
  });
  startDuel(session);
  return session;
}

function normalSummonTrigger(id: string, sourceUid: string, detail: string, optional = true): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller: 0,
    event: "trigger",
    triggerEvent: "normalSummoned",
    optional,
    range: ["hand"],
    operation(ctx) {
      ctx.log(detail);
    },
  };
}

function restoreMandatoryRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-order-first-mandatory": restoreLoggedEffect("Restored order first mandatory resolved"),
    "restore-order-second-mandatory": restoreLoggedEffect("Restored order second mandatory resolved"),
  };
}

function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-order-first-optional": restoreLoggedEffect("Restored order first optional resolved"),
    "restore-order-second-optional": restoreLoggedEffect("Restored order second optional resolved"),
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
