import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import type { DuelAction, DuelEffectDefinition, DuelResponse } from "#duel/types.js";
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
    expect(getGroupedDuelLegalActions(restored, 0).map((group) => group.actions.map((action) => action.type))).toEqual([
      ["activateTrigger", "activateTrigger"],
      ["declineTrigger", "declineTrigger"],
    ]);
    expect(hasGroupedTrigger(restored, 0, "restore-order-first-optional", "activateTrigger")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "restore-order-first-optional", "declineTrigger")).toBe(true);

    const decline = getDuelLegalActions(restored, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-order-first-optional");
    expect(decline).toBeDefined();
    assertStalePreviousWindow(restored, decline!, 0);
    const declined = applyAndAssert(restored, decline!);
    expect(declined.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(declined.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-order-second-optional"]);
    expect(queryPublicState(restored).triggerOrderPrompt).toBeUndefined();
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "activateEffect" || action.type === "passChain")).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 0).map((group) => group.triggerBucket?.triggerIds)).toEqual([declined.state.pendingTriggers.map((trigger) => trigger.id), declined.state.pendingTriggers.map((trigger) => trigger.id)]);
    expect(getDuelLegalActions(restored, 0).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual([
      "restore-order-second-optional",
      "restore-order-second-optional",
    ]);
    const stalePromptDecline = applyResponse(restored, decline!);
    expect(stalePromptDecline.ok).toBe(false);
    expect(stalePromptDecline.error).toContain("Response is not currently legal");
    expect(stalePromptDecline.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(stalePromptDecline.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(stalePromptDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    assertLegalWindowMetadata(restored, stalePromptDecline, 0);

    const restoredSingleTrigger = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredSingleTrigger).triggerOrderPrompt).toBeUndefined();
    expect(restoredSingleTrigger.state.pendingTriggers).toEqual(restored.state.pendingTriggers);
    expect(getDuelLegalActions(restoredSingleTrigger, 0).some((action) => action.type === "activateEffect" || action.type === "passChain")).toBe(false);
    expect(getGroupedDuelLegalActions(restoredSingleTrigger, 0).map((group) => group.triggerBucket?.triggerIds)).toEqual([restoredSingleTrigger.state.pendingTriggers.map((trigger) => trigger.id), restoredSingleTrigger.state.pendingTriggers.map((trigger) => trigger.id)]);
    expect(getDuelLegalActions(restoredSingleTrigger, 0).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual([
      "restore-order-second-optional",
      "restore-order-second-optional",
    ]);
    expect(hasGroupedTrigger(restoredSingleTrigger, 0, "restore-order-second-optional", "activateTrigger")).toBe(true);
    expect(hasGroupedTrigger(restoredSingleTrigger, 0, "restore-order-second-optional", "declineTrigger")).toBe(true);
    const staleDecline = applyResponse(restoredSingleTrigger, decline!);
    expect(staleDecline.ok).toBe(false);
    expect(staleDecline.error).toContain("Response is not currently legal");
    expect(staleDecline.state.actionWindowId).toBe(restoredSingleTrigger.state.actionWindowId);
    expect(staleDecline.legalActions).toEqual(getDuelLegalActions(restoredSingleTrigger, 0));
    expect(staleDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredSingleTrigger, 0));
    assertLegalWindowMetadata(restoredSingleTrigger, staleDecline, 0);
  });

  it("restores same-bucket optional order prompts and clears them after activation", () => {
    const session = createPromptSession();
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(firstTriggerSource).toBeTruthy();
    expect(secondTriggerSource).toBeTruthy();
    registerEffect(session, normalSummonTrigger("restore-order-first-activation", firstTriggerSource!.uid, "Restored order first activation resolved"));
    registerEffect(session, normalSummonTrigger("restore-order-second-after-activation", secondTriggerSource!.uid, "Restored order second after activation resolved"));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid)!);
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreActivationRegistry());
    const prompt = queryPublicState(restored).triggerOrderPrompt;
    expect(prompt).toEqual({
      id: `${restored.state.actionWindowId}:turnOptional:0`,
      type: "orderTriggers",
      player: 0,
      triggerBucket: "turnOptional",
      triggerIds: restored.state.pendingTriggers.map((trigger) => trigger.id),
    });
    expect(getGroupedDuelLegalActions(restored, 0).map((group) => group.triggerBucket?.triggerIds)).toEqual([prompt!.triggerIds, prompt!.triggerIds]);
    expect(getGroupedDuelLegalActions(restored, 0).map((group) => group.actions.map((action) => action.type))).toEqual([
      ["activateTrigger", "activateTrigger"],
      ["declineTrigger", "declineTrigger"],
    ]);
    expect(hasGroupedTrigger(restored, 0, "restore-order-first-activation", "activateTrigger")).toBe(true);
    expect(hasGroupedTrigger(restored, 0, "restore-order-first-activation", "declineTrigger")).toBe(true);

    const activation = getDuelLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-order-first-activation");
    expect(activation).toBeDefined();
    assertStalePreviousWindow(restored, activation!, 0);
    const activated = applyAndAssert(restored, activation!);
    expect(activated.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(activated.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-order-second-after-activation"]);
    expect(queryPublicState(restored).triggerOrderPrompt).toBeUndefined();
    expect(restored.state.chain.map((link) => link.effectId)).toEqual(["restore-order-first-activation"]);
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "activateEffect" || action.type === "passChain")).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 0).map((group) => group.triggerBucket?.triggerIds)).toEqual([activated.state.pendingTriggers.map((trigger) => trigger.id), activated.state.pendingTriggers.map((trigger) => trigger.id)]);
    expect(getDuelLegalActions(restored, 0).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual([
      "restore-order-second-after-activation",
      "restore-order-second-after-activation",
    ]);

    const restoredSingleTrigger = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreActivationRegistry());
    expect(queryPublicState(restoredSingleTrigger).triggerOrderPrompt).toBeUndefined();
    expect(restoredSingleTrigger.state.pendingTriggers).toEqual(restored.state.pendingTriggers);
    expect(getDuelLegalActions(restoredSingleTrigger, 0).some((action) => action.type === "activateEffect" || action.type === "passChain")).toBe(false);
    expect(getGroupedDuelLegalActions(restoredSingleTrigger, 0).map((group) => group.triggerBucket?.triggerIds)).toEqual([restoredSingleTrigger.state.pendingTriggers.map((trigger) => trigger.id), restoredSingleTrigger.state.pendingTriggers.map((trigger) => trigger.id)]);
    expect(getDuelLegalActions(restoredSingleTrigger, 0).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual([
      "restore-order-second-after-activation",
      "restore-order-second-after-activation",
    ]);
    expect(hasGroupedTrigger(restoredSingleTrigger, 0, "restore-order-second-after-activation", "activateTrigger")).toBe(true);
    expect(hasGroupedTrigger(restoredSingleTrigger, 0, "restore-order-second-after-activation", "declineTrigger")).toBe(true);
    const staleActivation = applyResponse(restoredSingleTrigger, activation!);
    expect(staleActivation.ok).toBe(false);
    expect(staleActivation.error).toContain("Response is not currently legal");
    expect(staleActivation.state.actionWindowId).toBe(restoredSingleTrigger.state.actionWindowId);
    expect(staleActivation.legalActions).toEqual(getDuelLegalActions(restoredSingleTrigger, 0));
    expect(staleActivation.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredSingleTrigger, 0));
    assertLegalWindowMetadata(restoredSingleTrigger, staleActivation, 0);
    resolveRemainingTriggerAndAssertRestore(restoredSingleTrigger, 0, "restore-order-second-after-activation", restoreActivationRegistry());
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
    expect(getGroupedDuelLegalActions(restored, 0).map((group) => group.actions.map((action) => action.type))).toEqual([["activateTrigger", "activateTrigger"]]);
    expect(hasGroupedTrigger(restored, 0, "restore-order-first-mandatory", "activateTrigger")).toBe(true);

    const activation = getDuelLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-order-first-mandatory");
    expect(activation).toBeDefined();
    assertStalePreviousWindow(restored, activation!, 0);
    const activated = applyAndAssert(restored, activation!);
    expect(activated.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(activated.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-order-second-mandatory"]);
    expect(queryPublicState(restored).triggerOrderPrompt).toBeUndefined();
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "activateEffect" || action.type === "passChain")).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 0).map((group) => group.triggerBucket?.triggerIds)).toEqual([activated.state.pendingTriggers.map((trigger) => trigger.id)]);
    expect(getDuelLegalActions(restored, 0).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual(["restore-order-second-mandatory"]);

    const restoredSingleTrigger = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreMandatoryRegistry());
    expect(queryPublicState(restoredSingleTrigger).triggerOrderPrompt).toBeUndefined();
    expect(restoredSingleTrigger.state.pendingTriggers).toEqual(restored.state.pendingTriggers);
    expect(getDuelLegalActions(restoredSingleTrigger, 0).some((action) => action.type === "activateEffect" || action.type === "passChain")).toBe(false);
    expect(getGroupedDuelLegalActions(restoredSingleTrigger, 0).map((group) => group.triggerBucket?.triggerIds)).toEqual([restoredSingleTrigger.state.pendingTriggers.map((trigger) => trigger.id)]);
    expect(getDuelLegalActions(restoredSingleTrigger, 0).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual(["restore-order-second-mandatory"]);
    expect(hasGroupedTrigger(restoredSingleTrigger, 0, "restore-order-second-mandatory", "activateTrigger")).toBe(true);
    const staleActivation = applyResponse(restoredSingleTrigger, activation!);
    expect(staleActivation.ok).toBe(false);
    expect(staleActivation.error).toContain("Response is not currently legal");
    expect(staleActivation.state.actionWindowId).toBe(restoredSingleTrigger.state.actionWindowId);
    expect(staleActivation.legalActions).toEqual(getDuelLegalActions(restoredSingleTrigger, 0));
    expect(staleActivation.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredSingleTrigger, 0));
    assertLegalWindowMetadata(restoredSingleTrigger, staleActivation, 0);
    resolveRemainingTriggerAndAssertRestore(restoredSingleTrigger, 0, "restore-order-second-mandatory", restoreMandatoryRegistry());
  });

  it("restores opponent same-bucket order prompts after bucket handoff", () => {
    const session = createPromptSession();
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const firstOpponentSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    const secondOpponentSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "100");
    expect(summoned).toBeTruthy();
    expect(turnTriggerSource).toBeTruthy();
    expect(firstOpponentSource).toBeTruthy();
    expect(secondOpponentSource).toBeTruthy();
    registerEffect(session, normalSummonTrigger("restore-order-turn-handoff", turnTriggerSource!.uid, "Restored order turn handoff resolved"));
    registerEffect(session, opponentNormalSummonTrigger("restore-order-first-opponent", firstOpponentSource!.uid, "Restored order first opponent resolved"));
    registerEffect(session, opponentNormalSummonTrigger("restore-order-second-opponent", secondOpponentSource!.uid, "Restored order second opponent resolved"));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid)!);
    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreOpponentRegistry());
    const turnDecline = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-order-turn-handoff");
    expect(turnDecline).toBeDefined();
    applyAndAssert(restoredTurnBucket, turnDecline!);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreOpponentRegistry());
    const prompt = queryPublicState(restoredOpponentBucket).triggerOrderPrompt;
    expect(prompt).toEqual({
      id: `${restoredOpponentBucket.state.actionWindowId}:opponentOptional:1`,
      type: "orderTriggers",
      player: 1,
      triggerBucket: "opponentOptional",
      triggerIds: restoredOpponentBucket.state.pendingTriggers.map((trigger) => trigger.id),
    });
    expect(getDuelLegalActions(restoredOpponentBucket, 0)).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpponentBucket, 1).map((group) => group.triggerBucket?.triggerIds)).toEqual([prompt!.triggerIds, prompt!.triggerIds]);
    expect(getGroupedDuelLegalActions(restoredOpponentBucket, 1).map((group) => group.actions.map((action) => action.type))).toEqual([
      ["activateTrigger", "activateTrigger"],
      ["declineTrigger", "declineTrigger"],
    ]);
    expect(hasGroupedTrigger(restoredOpponentBucket, 1, "restore-order-first-opponent", "activateTrigger")).toBe(true);
    expect(hasGroupedTrigger(restoredOpponentBucket, 1, "restore-order-first-opponent", "declineTrigger")).toBe(true);

    const opponentDecline = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "declineTrigger" && action.effectId === "restore-order-first-opponent");
    expect(opponentDecline).toBeDefined();
    assertStalePreviousWindow(restoredOpponentBucket, opponentDecline!, 1);
    const declined = applyAndAssert(restoredOpponentBucket, opponentDecline!);
    expect(declined.state).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    expect(declined.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-order-second-opponent"]);
    expect(queryPublicState(restoredOpponentBucket).triggerOrderPrompt).toBeUndefined();
    expect(getDuelLegalActions(restoredOpponentBucket, 1).some((action) => action.type === "activateEffect" || action.type === "passChain")).toBe(false);
    expect(getGroupedDuelLegalActions(restoredOpponentBucket, 1).map((group) => group.triggerBucket?.triggerIds)).toEqual([declined.state.pendingTriggers.map((trigger) => trigger.id), declined.state.pendingTriggers.map((trigger) => trigger.id)]);
    expect(getDuelLegalActions(restoredOpponentBucket, 1).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual([
      "restore-order-second-opponent",
      "restore-order-second-opponent",
    ]);

    const restoredSingleTrigger = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), restoreOpponentRegistry());
    expect(queryPublicState(restoredSingleTrigger).triggerOrderPrompt).toBeUndefined();
    expect(restoredSingleTrigger.state.pendingTriggers).toEqual(restoredOpponentBucket.state.pendingTriggers);
    expect(getDuelLegalActions(restoredSingleTrigger, 1).some((action) => action.type === "activateEffect" || action.type === "passChain")).toBe(false);
    expect(getGroupedDuelLegalActions(restoredSingleTrigger, 1).map((group) => group.triggerBucket?.triggerIds)).toEqual([restoredSingleTrigger.state.pendingTriggers.map((trigger) => trigger.id), restoredSingleTrigger.state.pendingTriggers.map((trigger) => trigger.id)]);
    expect(getDuelLegalActions(restoredSingleTrigger, 1).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual([
      "restore-order-second-opponent",
      "restore-order-second-opponent",
    ]);
    expect(hasGroupedTrigger(restoredSingleTrigger, 1, "restore-order-second-opponent", "activateTrigger")).toBe(true);
    expect(hasGroupedTrigger(restoredSingleTrigger, 1, "restore-order-second-opponent", "declineTrigger")).toBe(true);
    const staleDecline = applyResponse(restoredSingleTrigger, opponentDecline!);
    expect(staleDecline.ok).toBe(false);
    expect(staleDecline.error).toContain("Response is not currently legal");
    expect(staleDecline.state.actionWindowId).toBe(restoredSingleTrigger.state.actionWindowId);
    expect(staleDecline.legalActions).toEqual(getDuelLegalActions(restoredSingleTrigger, 1));
    expect(staleDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredSingleTrigger, 1));
    assertLegalWindowMetadata(restoredSingleTrigger, staleDecline, 1);
  });

  it("restores opponent mandatory order prompts after bucket handoff", () => {
    const session = createPromptSession();
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const firstOpponentSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    const secondOpponentSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "100");
    expect(summoned).toBeTruthy();
    expect(turnTriggerSource).toBeTruthy();
    expect(firstOpponentSource).toBeTruthy();
    expect(secondOpponentSource).toBeTruthy();
    registerEffect(session, normalSummonTrigger("restore-order-turn-mandatory-handoff", turnTriggerSource!.uid, "Restored order turn mandatory handoff resolved", false));
    registerEffect(session, opponentNormalSummonTrigger("restore-order-first-opponent-mandatory", firstOpponentSource!.uid, "Restored order first opponent mandatory resolved", false));
    registerEffect(session, opponentNormalSummonTrigger("restore-order-second-opponent-mandatory", secondOpponentSource!.uid, "Restored order second opponent mandatory resolved", false));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid)!);
    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreOpponentMandatoryRegistry());
    const turnActivation = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-order-turn-mandatory-handoff");
    expect(turnActivation).toBeDefined();
    expect(getDuelLegalActions(restoredTurnBucket, 0).some((action) => action.type === "declineTrigger")).toBe(false);
    applyAndAssert(restoredTurnBucket, turnActivation!);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreOpponentMandatoryRegistry());
    const prompt = queryPublicState(restoredOpponentBucket).triggerOrderPrompt;
    expect(prompt).toEqual({
      id: `${restoredOpponentBucket.state.actionWindowId}:opponentMandatory:1`,
      type: "orderTriggers",
      player: 1,
      triggerBucket: "opponentMandatory",
      triggerIds: restoredOpponentBucket.state.pendingTriggers.map((trigger) => trigger.id),
    });
    expect(getDuelLegalActions(restoredOpponentBucket, 0)).toEqual([]);
    expect(getDuelLegalActions(restoredOpponentBucket, 1).some((action) => action.type === "declineTrigger")).toBe(false);
    expect(getGroupedDuelLegalActions(restoredOpponentBucket, 1).map((group) => group.triggerBucket?.triggerIds)).toEqual([prompt!.triggerIds]);
    expect(getGroupedDuelLegalActions(restoredOpponentBucket, 1).map((group) => group.actions.map((action) => action.type))).toEqual([["activateTrigger", "activateTrigger"]]);
    expect(hasGroupedTrigger(restoredOpponentBucket, 1, "restore-order-first-opponent-mandatory", "activateTrigger")).toBe(true);

    const opponentActivation = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "activateTrigger" && action.effectId === "restore-order-first-opponent-mandatory");
    expect(opponentActivation).toBeDefined();
    assertStalePreviousWindow(restoredOpponentBucket, opponentActivation!, 1);
    const activated = applyAndAssert(restoredOpponentBucket, opponentActivation!);
    expect(activated.state).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    expect(activated.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-order-second-opponent-mandatory"]);
    expect(queryPublicState(restoredOpponentBucket).triggerOrderPrompt).toBeUndefined();
    expect(getDuelLegalActions(restoredOpponentBucket, 1).some((action) => action.type === "activateEffect" || action.type === "passChain")).toBe(false);
    expect(getGroupedDuelLegalActions(restoredOpponentBucket, 1).map((group) => group.triggerBucket?.triggerIds)).toEqual([activated.state.pendingTriggers.map((trigger) => trigger.id)]);
    expect(getDuelLegalActions(restoredOpponentBucket, 1).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual(["restore-order-second-opponent-mandatory"]);

    const restoredSingleTrigger = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), restoreOpponentMandatoryRegistry());
    expect(queryPublicState(restoredSingleTrigger).triggerOrderPrompt).toBeUndefined();
    expect(restoredSingleTrigger.state.pendingTriggers).toEqual(restoredOpponentBucket.state.pendingTriggers);
    expect(getDuelLegalActions(restoredSingleTrigger, 1).some((action) => action.type === "activateEffect" || action.type === "passChain")).toBe(false);
    expect(getGroupedDuelLegalActions(restoredSingleTrigger, 1).map((group) => group.triggerBucket?.triggerIds)).toEqual([restoredSingleTrigger.state.pendingTriggers.map((trigger) => trigger.id)]);
    expect(getDuelLegalActions(restoredSingleTrigger, 1).filter((action) => action.type === "activateTrigger" || action.type === "declineTrigger").map((action) => action.effectId)).toEqual(["restore-order-second-opponent-mandatory"]);
    expect(hasGroupedTrigger(restoredSingleTrigger, 1, "restore-order-second-opponent-mandatory", "activateTrigger")).toBe(true);
    const staleActivation = applyResponse(restoredSingleTrigger, opponentActivation!);
    expect(staleActivation.ok).toBe(false);
    expect(staleActivation.error).toContain("Response is not currently legal");
    expect(staleActivation.state.actionWindowId).toBe(restoredSingleTrigger.state.actionWindowId);
    expect(staleActivation.legalActions).toEqual(getDuelLegalActions(restoredSingleTrigger, 1));
    expect(staleActivation.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredSingleTrigger, 1));
    assertLegalWindowMetadata(restoredSingleTrigger, staleActivation, 1);
    resolveRemainingTriggerAndAssertRestore(restoredSingleTrigger, 1, "restore-order-second-opponent-mandatory", restoreOpponentMandatoryRegistry());
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

function opponentNormalSummonTrigger(id: string, sourceUid: string, detail: string, optional = true): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller: 1,
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

function restoreActivationRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-order-first-activation": restoreLoggedEffect("Restored order first activation resolved"),
    "restore-order-second-after-activation": restoreLoggedEffect("Restored order second after activation resolved"),
  };
}

function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-order-first-optional": restoreLoggedEffect("Restored order first optional resolved"),
    "restore-order-second-optional": restoreLoggedEffect("Restored order second optional resolved"),
  };
}

function restoreOpponentRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-order-turn-handoff": restoreLoggedEffect("Restored order turn handoff resolved"),
    "restore-order-first-opponent": restoreLoggedEffect("Restored order first opponent resolved"),
    "restore-order-second-opponent": restoreLoggedEffect("Restored order second opponent resolved"),
  };
}

function restoreOpponentMandatoryRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-order-turn-mandatory-handoff": restoreLoggedEffect("Restored order turn mandatory handoff resolved"),
    "restore-order-first-opponent-mandatory": restoreLoggedEffect("Restored order first opponent mandatory resolved"),
    "restore-order-second-opponent-mandatory": restoreLoggedEffect("Restored order second opponent mandatory resolved"),
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
  assertLegalWindowMetadata(session, response, response.state.waitingFor!);
  return response;
}

function assertStalePreviousWindow(session: ReturnType<typeof createDuel>, action: DuelResponse, player: 0 | 1): void {
  const before = queryPublicState(session);
  const beforeChainPasses = [...session.state.chainPasses];
  const stale = applyResponse(session, { ...action, windowId: action.windowId! - 1 });
  expect(stale.ok).toBe(false);
  expect(stale.error).toContain("Response is not currently legal");
  expect(session.state.chainPasses).toEqual(beforeChainPasses);
  expect(queryPublicState(session).triggerOrderPrompt).toEqual(before.triggerOrderPrompt);
  expect(queryPublicState(session).pendingTriggerBuckets).toEqual(before.pendingTriggerBuckets);
  assertLegalWindowMetadata(session, stale, player);
}

function assertLegalWindowMetadata(session: ReturnType<typeof createDuel>, response: ReturnType<typeof applyResponse>, player: 0 | 1) {
  const windowId = session.state.actionWindowId;
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}

function resolveRemainingTriggerAndAssertRestore(
  session: ReturnType<typeof createDuel>,
  player: 0 | 1,
  effectId: string,
  registry: Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition>,
): void {
  const activation = getDuelLegalActions(session, player).find((action) => action.type === "activateTrigger" && action.effectId === effectId);
  expect(activation).toBeDefined();
  const activated = applyAndAssert(session, activation!);
  expect(queryPublicState(session).pendingTriggerBuckets).toEqual([]);
  if (activated.state.windowKind === "chainResponse") {
    expect(activated.state.pendingTriggers).toEqual([]);
    const passPlayer = activated.state.waitingFor!;
    const pass = getDuelLegalActions(session, passPlayer).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(hasGroupedPass(session, passPlayer)).toBe(true);
    const resolved = applyAndAssert(session, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(session.state.chainPasses).toEqual([]);
  }
  else {
    expect(activated.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(session.state.chainPasses).toEqual([]);
  }
  expect(queryPublicState(session).pendingTriggerBuckets).toEqual([]);

  const restoredAfterResolution = restoreDuel(serializeDuel(session), createCardReader(cards), registry);
  expect(queryPublicState(restoredAfterResolution)).toMatchObject({ waitingFor: 0, windowKind: "open", pendingTriggers: [], pendingTriggerBuckets: [] });
  expect(restoredAfterResolution.state.chainPasses).toEqual([]);
  expect(actionsWithoutWindowToken(getDuelLegalActions(restoredAfterResolution, 0))).toEqual(actionsWithoutWindowToken(getDuelLegalActions(session, 0)));
  expect(groupsWithoutWindowToken(getGroupedDuelLegalActions(restoredAfterResolution, 0))).toEqual(groupsWithoutWindowToken(getGroupedDuelLegalActions(session, 0)));
  expect(getDuelLegalActions(restoredAfterResolution, 1)).toEqual([]);
}

function actionsWithoutWindowToken(actions: DuelAction[]): Array<Omit<DuelAction, "windowToken">> {
  return actions.map((action) => {
    const { windowToken: _windowToken, ...rest } = action;
    return rest;
  });
}

function groupsWithoutWindowToken(groups: DuelLegalActionGroup[]): Array<Omit<DuelLegalActionGroup, "windowToken">> {
  return groups.map((group) => {
    const { windowToken: _windowToken, ...rest } = group;
    return {
      ...rest,
      actions: actionsWithoutWindowToken(group.actions) as DuelAction[],
    };
  });
}

function hasGroupedTrigger(
  session: ReturnType<typeof createDuel>,
  player: 0 | 1,
  effectId: string,
  actionType: "activateTrigger" | "declineTrigger",
): boolean {
  return getGroupedDuelLegalActions(session, player).some(
    (group) =>
      group.windowId === session.state.actionWindowId &&
      group.windowKind === "triggerBucket" &&
      group.actions.some(
        (action) => action.type === actionType && action.player === player && action.effectId === effectId && action.windowId === group.windowId && action.windowKind === "triggerBucket",
      ),
  );
}

function hasGroupedPass(session: ReturnType<typeof createDuel>, player: 0 | 1): boolean {
  return getGroupedDuelLegalActions(session, player).some(
    (group) =>
      group.windowId === session.state.actionWindowId &&
      group.windowKind === "chainResponse" &&
      group.actions.some((action) => action.type === "passChain" && action.player === player && action.windowId === group.windowId && action.windowKind === "chainResponse"),
  );
}
