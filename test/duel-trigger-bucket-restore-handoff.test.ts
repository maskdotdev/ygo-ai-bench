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
    registerEffect(session, chainOnlyQuickEffect("restore-chain-priority-after-opponent-decline", turnQuickSource!.uid, 0, "Restored chain priority after opponent decline resolved"));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-turn-optional-decline", "restore-opponent-optional-decline"]);

    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    const turnDecline = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-turn-optional-decline");
    expect(turnDecline).toBeDefined();
    expect(hasGroupedTrigger(getGroupedDuelLegalActions(restoredTurnBucket, 0), 0, "restore-turn-optional-decline", "declineTrigger")).toBe(true);
    applyAndAssert(restoredTurnBucket, turnDecline!);
    expect(restoredTurnBucket.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-opponent-optional-decline"]);
    expect(restoredTurnBucket.state.waitingFor).toBe(1);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentBucket)).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    expect(getDuelLegalActions(restoredOpponentBucket, 0)).toEqual([]);
    const opponentDecline = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "declineTrigger" && action.effectId === "restore-opponent-optional-decline");
    expect(opponentDecline).toBeDefined();
    expect(hasGroupedTrigger(getGroupedDuelLegalActions(restoredOpponentBucket, 1), 1, "restore-opponent-optional-decline", "declineTrigger")).toBe(true);
    const staleBeforeDecline = applyResponse(restoredOpponentBucket, { ...opponentDecline!, windowId: opponentDecline!.windowId! - 1 });
    expect(staleBeforeDecline.ok).toBe(false);
    expect(staleBeforeDecline.error).toContain("Response is not currently legal");
    expect(staleBeforeDecline.state.actionWindowId).toBe(restoredOpponentBucket.state.actionWindowId);
    expect(staleBeforeDecline.legalActions).toEqual(getDuelLegalActions(restoredOpponentBucket, 1));
    expect(staleBeforeDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentBucket, 1));
    assertRestoreLegalWindow(restoredOpponentBucket, staleBeforeDecline, staleBeforeDecline.state.waitingFor!);

    const declined = applyAndAssert(restoredOpponentBucket, opponentDecline!);
    expect(declined.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(declined.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, effectId: "restore-open-priority-after-opponent-decline", windowKind: "open" })]));
    expect(hasGroupedEffect(declined.legalActionGroups, 0, "restore-open-priority-after-opponent-decline", "open")).toBe(true);
    expect(declined.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-chain-priority-after-opponent-decline")).toBe(false);
    expect(hasGroupedEffect(declined.legalActionGroups, 0, "restore-chain-priority-after-opponent-decline", "open")).toBe(false);
    expect(restoredOpponentBucket.state.log.some((entry) => entry.action === "declineTrigger" && entry.detail === "restore-opponent-optional-decline")).toBe(true);
    expect(restoredOpponentBucket.state.log.some((entry) => entry.detail === "Restored opponent optional trigger resolved")).toBe(false);
    expect(getDuelLegalActions(restoredOpponentBucket, 1)).toEqual([]);
    const staleDecline = applyResponse(restoredOpponentBucket, opponentDecline!);
    expect(staleDecline.ok).toBe(false);
    expect(staleDecline.error).toContain("Response is not currently legal");
    expect(staleDecline.state.actionWindowId).toBe(restoredOpponentBucket.state.actionWindowId);
    expect(staleDecline.legalActions).toEqual(getDuelLegalActions(restoredOpponentBucket, 0));
    expect(staleDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentBucket, 0));
    assertRestoreLegalWindow(restoredOpponentBucket, staleDecline, staleDecline.state.waitingFor!);
  });

  it("returns restored opponent optional activations through chain response to open priority", () => {
    const session = createDuel({ seed: 2, startingHandSize: 3, cardReader: createCardReader(cards) });
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
    registerEffect(session, normalSummonTrigger("restore-turn-optional-before-opponent-activation", turnTriggerSource!.uid, 0, "Restored turn optional before opponent activation resolved"));
    registerEffect(session, normalSummonTrigger("restore-opponent-optional-activation", opponentTriggerSource!.uid, 1, "Restored opponent optional activation resolved"));
    registerEffect(session, openOnlyQuickEffect("restore-open-priority-after-opponent-activation", turnQuickSource!.uid, 0, "Restored open priority after opponent activation resolved"));
    registerEffect(session, chainOnlyQuickEffect("restore-turn-chain-response-after-opponent-activation", turnQuickSource!.uid, 0, "Restored turn chain response after opponent activation resolved"));
    registerEffect(session, openOnlyQuickEffect("restore-opponent-open-after-opponent-activation", opponentTriggerSource!.uid, 1, "Restored opponent open after opponent activation resolved"));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreActivationRegistry());
    const turnDecline = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-turn-optional-before-opponent-activation");
    expect(turnDecline).toBeDefined();
    expect(hasGroupedTrigger(getGroupedDuelLegalActions(restoredTurnBucket, 0), 0, "restore-turn-optional-before-opponent-activation", "declineTrigger")).toBe(true);
    applyAndAssert(restoredTurnBucket, turnDecline!);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreActivationRegistry());
    expect(queryPublicState(restoredOpponentBucket)).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    const opponentActivation = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "activateTrigger" && action.effectId === "restore-opponent-optional-activation");
    expect(opponentActivation).toBeDefined();
    expect(hasGroupedTrigger(getGroupedDuelLegalActions(restoredOpponentBucket, 1), 1, "restore-opponent-optional-activation", "activateTrigger")).toBe(true);
    const activated = applyAndAssert(restoredOpponentBucket, opponentActivation!);
    expect(activated.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse", pendingTriggers: [] });
    expect(activated.state.chain.map((link) => link.effectId)).toEqual(["restore-opponent-optional-activation"]);
    expect(activated.state.log.some((entry) => entry.detail === "Restored opponent optional activation resolved")).toBe(false);
    expect(getDuelLegalActions(restoredOpponentBucket, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredOpponentBucket, 0)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", effectId: "restore-turn-chain-response-after-opponent-activation", windowKind: "chainResponse" })]));
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredOpponentBucket, 0), 0, "restore-turn-chain-response-after-opponent-activation", "chainResponse")).toBe(true);
    expect(getDuelLegalActions(restoredOpponentBucket, 0).some((action) => action.type === "activateEffect" && action.effectId === "restore-open-priority-after-opponent-activation")).toBe(false);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredOpponentBucket, 0), 0, "restore-open-priority-after-opponent-activation", "chainResponse")).toBe(false);

    const restoredChainWindow = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), restoreActivationRegistry());
    expect(queryPublicState(restoredChainWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    const quick = getDuelLegalActions(restoredChainWindow, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-turn-chain-response-after-opponent-activation");
    expect(quick).toBeDefined();
    const quickResult = applyAndAssert(restoredChainWindow, quick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse", pendingTriggers: [] });
    expect(quickResult.state.chain.map((link) => link.effectId)).toEqual(["restore-opponent-optional-activation", "restore-turn-chain-response-after-opponent-activation"]);
    expect(hasGroupedEffect(quickResult.legalActionGroups, 0, "restore-open-priority-after-opponent-activation", "chainResponse")).toBe(false);
    expect(hasGroupedEffect(quickResult.legalActionGroups, 1, "restore-opponent-open-after-opponent-activation", "chainResponse")).toBe(false);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored opponent optional activation resolved")).toBe(false);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored turn chain response after opponent activation resolved")).toBe(false);
    const staleQuick = applyResponse(restoredChainWindow, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.state.actionWindowId).toBe(restoredChainWindow.state.actionWindowId);
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restoredChainWindow, 0));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredChainWindow, 0));
    assertRestoreLegalWindow(restoredChainWindow, staleQuick, staleQuick.state.waitingFor!);
    const pass = getDuelLegalActions(restoredChainWindow, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const staleBeforePass = applyResponse(restoredChainWindow, { ...pass!, windowId: pass!.windowId! - 1 });
    expect(staleBeforePass.ok).toBe(false);
    expect(staleBeforePass.error).toContain("Response is not currently legal");
    expect(staleBeforePass.state.actionWindowId).toBe(restoredChainWindow.state.actionWindowId);
    expect(staleBeforePass.legalActions).toEqual(getDuelLegalActions(restoredChainWindow, 0));
    expect(staleBeforePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredChainWindow, 0));
    assertRestoreLegalWindow(restoredChainWindow, staleBeforePass, staleBeforePass.state.waitingFor!);

    const resolved = applyAndAssert(restoredChainWindow, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(resolved.state.log.some((entry) => entry.detail === "Restored opponent optional activation resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored turn chain response after opponent activation resolved")).toBe(true);
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, effectId: "restore-open-priority-after-opponent-activation", windowKind: "open" })]));
    expect(hasGroupedEffect(resolved.legalActionGroups, 0, "restore-open-priority-after-opponent-activation", "open")).toBe(true);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-turn-chain-response-after-opponent-activation")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-opponent-open-after-opponent-activation")).toBe(false);
    expect(hasGroupedEffect(resolved.legalActionGroups, 0, "restore-turn-chain-response-after-opponent-activation", "open")).toBe(false);
    expect(hasGroupedEffect(resolved.legalActionGroups, 1, "restore-opponent-open-after-opponent-activation", "open")).toBe(false);
    expect(getDuelLegalActions(restoredChainWindow, 1)).toEqual([]);
    const stalePass = applyResponse(restoredChainWindow, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restoredChainWindow.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restoredChainWindow, 0));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredChainWindow, 0));
    assertRestoreLegalWindow(restoredChainWindow, stalePass, stalePass.state.waitingFor!);
  });

  it("returns restored opponent mandatory activations through chain response to open priority", () => {
    const session = createDuel({ seed: 3, startingHandSize: 3, cardReader: createCardReader(cards) });
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
    registerEffect(session, normalSummonTrigger("restore-turn-mandatory-before-opponent-activation", turnTriggerSource!.uid, 0, "Restored turn mandatory before opponent activation resolved", false));
    registerEffect(session, normalSummonTrigger("restore-opponent-mandatory-activation", opponentTriggerSource!.uid, 1, "Restored opponent mandatory activation resolved", false));
    registerEffect(session, openOnlyQuickEffect("restore-open-priority-after-opponent-mandatory", turnQuickSource!.uid, 0, "Restored open priority after opponent mandatory resolved"));
    registerEffect(session, chainOnlyQuickEffect("restore-turn-chain-response-after-opponent-mandatory", turnQuickSource!.uid, 0, "Restored turn chain response after opponent mandatory resolved"));
    registerEffect(session, openOnlyQuickEffect("restore-opponent-open-after-opponent-mandatory", opponentTriggerSource!.uid, 1, "Restored opponent open after opponent mandatory resolved"));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreMandatoryRegistry());
    const turnActivation = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-turn-mandatory-before-opponent-activation");
    expect(turnActivation).toBeDefined();
    expect(getDuelLegalActions(restoredTurnBucket, 0).some((action) => action.type === "declineTrigger")).toBe(false);
    expect(hasGroupedTrigger(getGroupedDuelLegalActions(restoredTurnBucket, 0), 0, "restore-turn-mandatory-before-opponent-activation", "activateTrigger")).toBe(true);
    applyAndAssert(restoredTurnBucket, turnActivation!);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreMandatoryRegistry());
    expect(queryPublicState(restoredOpponentBucket)).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    expect(getDuelLegalActions(restoredOpponentBucket, 1).some((action) => action.type === "declineTrigger")).toBe(false);
    const opponentActivation = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "activateTrigger" && action.effectId === "restore-opponent-mandatory-activation");
    expect(opponentActivation).toBeDefined();
    expect(hasGroupedTrigger(getGroupedDuelLegalActions(restoredOpponentBucket, 1), 1, "restore-opponent-mandatory-activation", "activateTrigger")).toBe(true);
    const activated = applyAndAssert(restoredOpponentBucket, opponentActivation!);
    expect(activated.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse", pendingTriggers: [] });
    expect(activated.state.chain.map((link) => link.effectId)).toEqual(["restore-turn-mandatory-before-opponent-activation", "restore-opponent-mandatory-activation"]);
    expect(getDuelLegalActions(restoredOpponentBucket, 0)).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", effectId: "restore-turn-chain-response-after-opponent-mandatory", windowKind: "chainResponse" })]));
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredOpponentBucket, 0), 0, "restore-turn-chain-response-after-opponent-mandatory", "chainResponse")).toBe(true);
    expect(getDuelLegalActions(restoredOpponentBucket, 0).some((action) => action.type === "activateEffect" && action.effectId === "restore-open-priority-after-opponent-mandatory")).toBe(false);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredOpponentBucket, 0), 0, "restore-open-priority-after-opponent-mandatory", "chainResponse")).toBe(false);

    const restoredChainWindow = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), restoreMandatoryRegistry());
    const quick = getDuelLegalActions(restoredChainWindow, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-turn-chain-response-after-opponent-mandatory");
    expect(quick).toBeDefined();
    const quickResult = applyAndAssert(restoredChainWindow, quick!);
    expect(quickResult.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse", pendingTriggers: [] });
    expect(quickResult.state.chain.map((link) => link.effectId)).toEqual([
      "restore-turn-mandatory-before-opponent-activation",
      "restore-opponent-mandatory-activation",
      "restore-turn-chain-response-after-opponent-mandatory",
    ]);
    expect(hasGroupedEffect(quickResult.legalActionGroups, 0, "restore-open-priority-after-opponent-mandatory", "chainResponse")).toBe(false);
    expect(hasGroupedEffect(quickResult.legalActionGroups, 1, "restore-opponent-open-after-opponent-mandatory", "chainResponse")).toBe(false);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored turn mandatory before opponent activation resolved")).toBe(false);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored opponent mandatory activation resolved")).toBe(false);
    expect(quickResult.state.log.some((entry) => entry.detail === "Restored turn chain response after opponent mandatory resolved")).toBe(false);
    const staleQuick = applyResponse(restoredChainWindow, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.state.actionWindowId).toBe(restoredChainWindow.state.actionWindowId);
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restoredChainWindow, 0));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredChainWindow, 0));
    assertRestoreLegalWindow(restoredChainWindow, staleQuick, staleQuick.state.waitingFor!);
    const pass = getDuelLegalActions(restoredChainWindow, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const staleBeforePass = applyResponse(restoredChainWindow, { ...pass!, windowId: pass!.windowId! - 1 });
    expect(staleBeforePass.ok).toBe(false);
    expect(staleBeforePass.error).toContain("Response is not currently legal");
    expect(staleBeforePass.state.actionWindowId).toBe(restoredChainWindow.state.actionWindowId);
    expect(staleBeforePass.legalActions).toEqual(getDuelLegalActions(restoredChainWindow, 0));
    expect(staleBeforePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredChainWindow, 0));
    assertRestoreLegalWindow(restoredChainWindow, staleBeforePass, staleBeforePass.state.waitingFor!);

    const resolved = applyAndAssert(restoredChainWindow, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(resolved.state.log.some((entry) => entry.detail === "Restored turn mandatory before opponent activation resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored opponent mandatory activation resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored turn chain response after opponent mandatory resolved")).toBe(true);
    expect(resolved.legalActions).toEqual(expect.arrayContaining([expect.objectContaining({ type: "activateEffect", player: 0, effectId: "restore-open-priority-after-opponent-mandatory", windowKind: "open" })]));
    expect(hasGroupedEffect(resolved.legalActionGroups, 0, "restore-open-priority-after-opponent-mandatory", "open")).toBe(true);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-turn-chain-response-after-opponent-mandatory")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-opponent-open-after-opponent-mandatory")).toBe(false);
    expect(hasGroupedEffect(resolved.legalActionGroups, 0, "restore-turn-chain-response-after-opponent-mandatory", "open")).toBe(false);
    expect(hasGroupedEffect(resolved.legalActionGroups, 1, "restore-opponent-open-after-opponent-mandatory", "open")).toBe(false);
    const stalePass = applyResponse(restoredChainWindow, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.state.actionWindowId).toBe(restoredChainWindow.state.actionWindowId);
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restoredChainWindow, 0));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredChainWindow, 0));
    assertRestoreLegalWindow(restoredChainWindow, stalePass, stalePass.state.waitingFor!);
  });
});

function normalSummonTrigger(id: string, sourceUid: string, controller: 0 | 1, detail: string, optional = true): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "trigger",
    triggerEvent: "normalSummoned",
    optional,
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

function chainOnlyQuickEffect(id: string, sourceUid: string, controller: 0 | 1, detail: string): DuelEffectDefinition {
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
      return ctx.duel.chain.length > 0;
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
    "restore-chain-priority-after-opponent-decline": (effect) => ({
      ...restoreLoggedEffect("Restored chain priority after opponent decline resolved")(effect),
      canActivate(ctx) {
        return ctx.duel.chain.length > 0;
      },
    }),
  };
}

function restoreActivationRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-turn-optional-before-opponent-activation": restoreLoggedEffect("Restored turn optional before opponent activation resolved"),
    "restore-opponent-optional-activation": restoreLoggedEffect("Restored opponent optional activation resolved"),
    "restore-open-priority-after-opponent-activation": (effect) => ({
      ...restoreLoggedEffect("Restored open priority after opponent activation resolved")(effect),
      canActivate(ctx) {
        return ctx.duel.chain.length === 0;
      },
    }),
    "restore-turn-chain-response-after-opponent-activation": (effect) => ({
      ...restoreLoggedEffect("Restored turn chain response after opponent activation resolved")(effect),
      canActivate(ctx) {
        return ctx.duel.chain.length > 0;
      },
    }),
    "restore-opponent-open-after-opponent-activation": (effect) => ({
      ...restoreLoggedEffect("Restored opponent open after opponent activation resolved")(effect),
      canActivate(ctx) {
        return ctx.duel.chain.length === 0;
      },
    }),
  };
}

function restoreMandatoryRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-turn-mandatory-before-opponent-activation": restoreLoggedEffect("Restored turn mandatory before opponent activation resolved"),
    "restore-opponent-mandatory-activation": restoreLoggedEffect("Restored opponent mandatory activation resolved"),
    "restore-open-priority-after-opponent-mandatory": (effect) => ({
      ...restoreLoggedEffect("Restored open priority after opponent mandatory resolved")(effect),
      canActivate(ctx) {
        return ctx.duel.chain.length === 0;
      },
    }),
    "restore-turn-chain-response-after-opponent-mandatory": (effect) => ({
      ...restoreLoggedEffect("Restored turn chain response after opponent mandatory resolved")(effect),
      canActivate(ctx) {
        return ctx.duel.chain.length > 0;
      },
    }),
    "restore-opponent-open-after-opponent-mandatory": (effect) => ({
      ...restoreLoggedEffect("Restored opponent open after opponent mandatory resolved")(effect),
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
  assertRestoreLegalWindow(session, response, response.state.waitingFor!);
  return response;
}

function assertRestoreLegalWindow(session: ReturnType<typeof createDuel>, response: ReturnType<typeof applyResponse>, player: 0 | 1): void {
  const windowId = session.state.actionWindowId;
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}

function hasGroupedEffect(
  groups: ReturnType<typeof getGroupedDuelLegalActions>,
  player: 0 | 1,
  effectId: string,
  windowKind: "chainResponse" | "open",
): boolean {
  return groups.some((group) =>
    group.windowKind === windowKind && group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowKind === windowKind),
  );
}

function hasGroupedTrigger(
  groups: ReturnType<typeof getGroupedDuelLegalActions>,
  player: 0 | 1,
  effectId: string,
  actionType: "activateTrigger" | "declineTrigger",
): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "triggerBucket" &&
      group.actions.some(
        (action) => action.type === actionType && action.player === player && action.effectId === effectId && action.windowId === group.windowId && action.windowKind === "triggerBucket",
      ),
  );
}
