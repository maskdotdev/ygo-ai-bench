import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import type { DuelAction, DuelEffectDefinition, DuelResponse } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("trigger chain-window restore", () => {
  it("restores fast-effect priority only after sibling trigger selection completes", () => {
    const session = createTriggerSession();
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(summoned).toBeTruthy();
    expect(firstTriggerSource).toBeTruthy();
    expect(secondTriggerSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    registerEffect(session, normalSummonTrigger("restore-first-chain-window-trigger", firstTriggerSource!.uid, "Restored first trigger resolved"));
    registerEffect(session, normalSummonTrigger("restore-second-held-trigger", secondTriggerSource!.uid, "Restored second trigger resolved"));
    registerEffect(session, chainOnlyQuickEffect("restore-opponent-chain-window-quick", opponentQuickSource!.uid, 1, "Restored opponent chain-window quick resolved"));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid)!);
    const restoredFirstBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    const firstTrigger = getDuelLegalActions(restoredFirstBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-first-chain-window-trigger");
    expect(firstTrigger).toBeDefined();
    expect(hasGroupedTrigger(getGroupedDuelLegalActions(restoredFirstBucket, 0), 0, "restore-first-chain-window-trigger")).toBe(true);
    const afterFirstTrigger = applyAndAssert(restoredFirstBucket, firstTrigger!);
    expect(afterFirstTrigger.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(afterFirstTrigger.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-second-held-trigger", eventName: "normalSummoned", eventCardUid: summoned!.uid }),
    ]);
    expect(getDuelLegalActions(restoredFirstBucket, 1).some((action) => action.type === "activateEffect" && action.effectId === "restore-opponent-chain-window-quick")).toBe(false);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredFirstBucket, 1), 1, "restore-opponent-chain-window-quick", "triggerBucket")).toBe(false);

    const restoredSecondBucket = restoreDuel(serializeDuel(restoredFirstBucket), createCardReader(cards), restoreRegistry());
    const secondTrigger = getDuelLegalActions(restoredSecondBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-second-held-trigger");
    expect(secondTrigger).toBeDefined();
    expect(hasGroupedTrigger(getGroupedDuelLegalActions(restoredSecondBucket, 0), 0, "restore-second-held-trigger")).toBe(true);
    const afterSecondTrigger = applyAndAssert(restoredSecondBucket, secondTrigger!);
    expect(afterSecondTrigger.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(afterSecondTrigger.state.pendingTriggers).toEqual([]);
    expect(afterSecondTrigger.state.chain.map((link) => link.effectId)).toEqual(["restore-first-chain-window-trigger", "restore-second-held-trigger"]);

    const restoredChainWindow = restoreDuel(serializeDuel(restoredSecondBucket), createCardReader(cards), restoreRegistry());
    const opponentQuick = getDuelLegalActions(restoredChainWindow, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-opponent-chain-window-quick");
    expect(opponentQuick).toBeDefined();
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredChainWindow, 1), 1, "restore-opponent-chain-window-quick", "chainResponse")).toBe(true);
    expect(getDuelLegalActions(restoredChainWindow, 0)).toEqual([]);
    assertStaleResponse(restoredChainWindow, secondTrigger!);

    const afterOpponentQuick = applyAndAssert(restoredChainWindow, opponentQuick!);
    expect(afterOpponentQuick.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [] });
    expect(afterOpponentQuick.state.chain.map((link) => link.effectId)).toEqual([
      "restore-first-chain-window-trigger",
      "restore-second-held-trigger",
      "restore-opponent-chain-window-quick",
    ]);
    expect(afterOpponentQuick.state.log.some((entry) => entry.detail === "Restored first trigger resolved")).toBe(false);
    expect(afterOpponentQuick.state.log.some((entry) => entry.detail === "Restored second trigger resolved")).toBe(false);
    expect(afterOpponentQuick.state.log.some((entry) => entry.detail === "Restored opponent chain-window quick resolved")).toBe(false);
    assertStaleResponse(restoredChainWindow, opponentQuick!);

    const pass = getDuelLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(hasGroupedPass(getGroupedDuelLegalActions(restoredChainWindow, 1), 1)).toBe(true);
    assertStalePreviousWindow(restoredChainWindow, pass!);
    const resolved = applyAndAssert(restoredChainWindow, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(resolved.state.log.some((entry) => entry.detail === "Restored first trigger resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored second trigger resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored opponent chain-window quick resolved")).toBe(true);
    expect(hasGroupedEffect(resolved.legalActionGroups, 1, "restore-opponent-chain-window-quick", "open")).toBe(false);
    const restoredAfterResolution = restoreDuel(serializeDuel(restoredChainWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredAfterResolution)).toMatchObject({ waitingFor: 0, windowKind: "open", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredAfterResolution.state.chainPasses).toEqual([]);
    expect(actionsWithoutWindowToken(getDuelLegalActions(restoredAfterResolution, 0))).toEqual(actionsWithoutWindowToken(getDuelLegalActions(restoredChainWindow, 0)));
    expect(groupsWithoutWindowToken(getGroupedDuelLegalActions(restoredAfterResolution, 0))).toEqual(groupsWithoutWindowToken(getGroupedDuelLegalActions(restoredChainWindow, 0)));
    expect(getDuelLegalActions(restoredAfterResolution, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredAfterResolution, 1)).toEqual([]);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredAfterResolution, 1), 1, "restore-opponent-chain-window-quick", "open")).toBe(false);
    assertStaleResponse(restoredChainWindow, pass!);
  });

  it("restores fast-effect priority after declining a held optional sibling trigger", () => {
    const session = createTriggerSession();
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(summoned).toBeTruthy();
    expect(firstTriggerSource).toBeTruthy();
    expect(secondTriggerSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    registerEffect(session, normalSummonTrigger("restore-decline-first-chain-window-trigger", firstTriggerSource!.uid, "Restored decline first trigger resolved"));
    registerEffect(session, normalSummonTrigger("restore-decline-second-held-trigger", secondTriggerSource!.uid, "Restored decline second trigger should not resolve"));
    registerEffect(session, chainOnlyQuickEffect("restore-decline-opponent-chain-window-quick", opponentQuickSource!.uid, 1, "Restored decline opponent chain-window quick resolved"));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid)!);
    const restoredFirstBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreDeclineRegistry());
    const firstTrigger = getDuelLegalActions(restoredFirstBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-decline-first-chain-window-trigger");
    expect(firstTrigger).toBeDefined();
    applyAndAssert(restoredFirstBucket, firstTrigger!);

    const restoredHeldBucket = restoreDuel(serializeDuel(restoredFirstBucket), createCardReader(cards), restoreDeclineRegistry());
    const heldDecline = getDuelLegalActions(restoredHeldBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-decline-second-held-trigger");
    expect(heldDecline).toBeDefined();
    expect(hasGroupedTrigger(getGroupedDuelLegalActions(restoredHeldBucket, 0), 0, "restore-decline-second-held-trigger")).toBe(true);
    const afterDecline = applyAndAssert(restoredHeldBucket, heldDecline!);
    expect(afterDecline.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(afterDecline.state.chain.map((link) => link.effectId)).toEqual(["restore-decline-first-chain-window-trigger"]);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredHeldBucket, 1), 1, "restore-decline-opponent-chain-window-quick", "chainResponse")).toBe(true);
    assertStaleResponse(restoredHeldBucket, heldDecline!);

    const restoredChainWindow = restoreDuel(serializeDuel(restoredHeldBucket), createCardReader(cards), restoreDeclineRegistry());
    const opponentQuick = getDuelLegalActions(restoredChainWindow, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-decline-opponent-chain-window-quick");
    expect(opponentQuick).toBeDefined();
    assertStalePreviousWindow(restoredChainWindow, opponentQuick!);
    const afterOpponentQuick = applyAndAssert(restoredChainWindow, opponentQuick!);
    expect(afterOpponentQuick.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(afterOpponentQuick.state.chain.map((link) => link.effectId)).toEqual([
      "restore-decline-first-chain-window-trigger",
      "restore-decline-opponent-chain-window-quick",
    ]);
    expect(afterOpponentQuick.state.log.some((entry) => entry.detail === "Restored decline first trigger resolved")).toBe(false);
    expect(afterOpponentQuick.state.log.some((entry) => entry.detail === "Restored decline second trigger should not resolve")).toBe(false);
    expect(afterOpponentQuick.state.log.some((entry) => entry.detail === "Restored decline opponent chain-window quick resolved")).toBe(false);
    assertStaleResponse(restoredChainWindow, opponentQuick!);

    const pass = getDuelLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(hasGroupedPass(getGroupedDuelLegalActions(restoredChainWindow, 1), 1)).toBe(true);
    assertStalePreviousWindow(restoredChainWindow, pass!);
    const resolved = applyAndAssert(restoredChainWindow, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(resolved.state.log.some((entry) => entry.detail === "Restored decline first trigger resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored decline second trigger should not resolve")).toBe(false);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored decline opponent chain-window quick resolved")).toBe(true);
    expect(hasGroupedEffect(resolved.legalActionGroups, 1, "restore-decline-opponent-chain-window-quick", "open")).toBe(false);
    expect(restoredChainWindow.state.chainPasses).toEqual([]);
    assertStaleResponse(restoredChainWindow, pass!);
  });

  it("restores mandatory sibling triggers before exposing fast-effect priority", () => {
    const session = createTriggerSession();
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondTriggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const opponentQuickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(summoned).toBeTruthy();
    expect(firstTriggerSource).toBeTruthy();
    expect(secondTriggerSource).toBeTruthy();
    expect(opponentQuickSource).toBeTruthy();
    registerEffect(session, normalSummonTrigger("restore-first-mandatory-chain-window-trigger", firstTriggerSource!.uid, "Restored first mandatory trigger resolved", false));
    registerEffect(session, normalSummonTrigger("restore-second-mandatory-held-trigger", secondTriggerSource!.uid, "Restored second mandatory trigger resolved", false));
    registerEffect(session, chainOnlyQuickEffect("restore-opponent-mandatory-chain-window-quick", opponentQuickSource!.uid, 1, "Restored opponent mandatory chain-window quick resolved"));

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid)!);
    const restoredFirstBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreMandatoryRegistry());
    expect(getDuelLegalActions(restoredFirstBucket, 0).some((action) => action.type === "declineTrigger")).toBe(false);
    const firstTrigger = getDuelLegalActions(restoredFirstBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-first-mandatory-chain-window-trigger");
    expect(firstTrigger).toBeDefined();
    expect(hasGroupedTrigger(getGroupedDuelLegalActions(restoredFirstBucket, 0), 0, "restore-first-mandatory-chain-window-trigger")).toBe(true);
    const afterFirstTrigger = applyAndAssert(restoredFirstBucket, firstTrigger!);
    expect(afterFirstTrigger.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(afterFirstTrigger.state.chain.map((link) => link.effectId)).toEqual(["restore-first-mandatory-chain-window-trigger"]);
    expect(afterFirstTrigger.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-second-mandatory-held-trigger", eventName: "normalSummoned", eventCardUid: summoned!.uid }),
    ]);
    expect(getDuelLegalActions(restoredFirstBucket, 1).some((action) => action.type === "activateEffect" && action.effectId === "restore-opponent-mandatory-chain-window-quick")).toBe(false);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredFirstBucket, 1), 1, "restore-opponent-mandatory-chain-window-quick", "triggerBucket")).toBe(false);

    const restoredSecondBucket = restoreDuel(serializeDuel(restoredFirstBucket), createCardReader(cards), restoreMandatoryRegistry());
    expect(getDuelLegalActions(restoredSecondBucket, 0).some((action) => action.type === "declineTrigger")).toBe(false);
    const secondTrigger = getDuelLegalActions(restoredSecondBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-second-mandatory-held-trigger");
    expect(secondTrigger).toBeDefined();
    expect(hasGroupedTrigger(getGroupedDuelLegalActions(restoredSecondBucket, 0), 0, "restore-second-mandatory-held-trigger")).toBe(true);
    const afterSecondTrigger = applyAndAssert(restoredSecondBucket, secondTrigger!);
    expect(afterSecondTrigger.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [] });
    expect(afterSecondTrigger.state.chain.map((link) => link.effectId)).toEqual(["restore-first-mandatory-chain-window-trigger", "restore-second-mandatory-held-trigger"]);

    const restoredChainWindow = restoreDuel(serializeDuel(restoredSecondBucket), createCardReader(cards), restoreMandatoryRegistry());
    const opponentQuick = getDuelLegalActions(restoredChainWindow, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-opponent-mandatory-chain-window-quick");
    expect(opponentQuick).toBeDefined();
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredChainWindow, 1), 1, "restore-opponent-mandatory-chain-window-quick", "chainResponse")).toBe(true);
    expect(getDuelLegalActions(restoredChainWindow, 0)).toEqual([]);
    assertStaleResponse(restoredChainWindow, secondTrigger!);

    const afterOpponentQuick = applyAndAssert(restoredChainWindow, opponentQuick!);
    expect(afterOpponentQuick.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [] });
    expect(afterOpponentQuick.state.chain.map((link) => link.effectId)).toEqual([
      "restore-first-mandatory-chain-window-trigger",
      "restore-second-mandatory-held-trigger",
      "restore-opponent-mandatory-chain-window-quick",
    ]);
    expect(afterOpponentQuick.state.log.some((entry) => entry.detail === "Restored first mandatory trigger resolved")).toBe(false);
    expect(afterOpponentQuick.state.log.some((entry) => entry.detail === "Restored second mandatory trigger resolved")).toBe(false);
    expect(afterOpponentQuick.state.log.some((entry) => entry.detail === "Restored opponent mandatory chain-window quick resolved")).toBe(false);
    assertStaleResponse(restoredChainWindow, opponentQuick!);

    const pass = getDuelLegalActions(restoredChainWindow, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    expect(hasGroupedPass(getGroupedDuelLegalActions(restoredChainWindow, 1), 1)).toBe(true);
    assertStalePreviousWindow(restoredChainWindow, pass!);
    const resolved = applyAndAssert(restoredChainWindow, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(resolved.state.log.some((entry) => entry.detail === "Restored first mandatory trigger resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored second mandatory trigger resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored opponent mandatory chain-window quick resolved")).toBe(true);
    expect(hasGroupedEffect(resolved.legalActionGroups, 1, "restore-opponent-mandatory-chain-window-quick", "open")).toBe(false);
    const restoredAfterResolution = restoreDuel(serializeDuel(restoredChainWindow), createCardReader(cards), restoreMandatoryRegistry());
    expect(queryPublicState(restoredAfterResolution)).toMatchObject({ waitingFor: 0, windowKind: "open", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredAfterResolution.state.chainPasses).toEqual([]);
    expect(actionsWithoutWindowToken(getDuelLegalActions(restoredAfterResolution, 0))).toEqual(actionsWithoutWindowToken(getDuelLegalActions(restoredChainWindow, 0)));
    expect(groupsWithoutWindowToken(getGroupedDuelLegalActions(restoredAfterResolution, 0))).toEqual(groupsWithoutWindowToken(getGroupedDuelLegalActions(restoredChainWindow, 0)));
    expect(getDuelLegalActions(restoredAfterResolution, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredAfterResolution, 1)).toEqual([]);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredAfterResolution, 1), 1, "restore-opponent-mandatory-chain-window-quick", "open")).toBe(false);
    assertStaleResponse(restoredChainWindow, pass!);
  });
});

function createTriggerSession() {
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
    "restore-first-chain-window-trigger": restoreLoggedEffect("Restored first trigger resolved"),
    "restore-second-held-trigger": restoreLoggedEffect("Restored second trigger resolved"),
    "restore-opponent-chain-window-quick": (effect) => ({
      ...restoreLoggedEffect("Restored opponent chain-window quick resolved")(effect),
      canActivate(ctx) {
        return ctx.duel.chain.length > 0;
      },
    }),
  };
}

function restoreMandatoryRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-first-mandatory-chain-window-trigger": restoreLoggedEffect("Restored first mandatory trigger resolved"),
    "restore-second-mandatory-held-trigger": restoreLoggedEffect("Restored second mandatory trigger resolved"),
    "restore-opponent-mandatory-chain-window-quick": (effect) => ({
      ...restoreLoggedEffect("Restored opponent mandatory chain-window quick resolved")(effect),
      canActivate(ctx) {
        return ctx.duel.chain.length > 0;
      },
    }),
  };
}

function restoreDeclineRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-decline-first-chain-window-trigger": restoreLoggedEffect("Restored decline first trigger resolved"),
    "restore-decline-second-held-trigger": restoreLoggedEffect("Restored decline second trigger should not resolve"),
    "restore-decline-opponent-chain-window-quick": (effect) => ({
      ...restoreLoggedEffect("Restored decline opponent chain-window quick resolved")(effect),
      canActivate(ctx) {
        return ctx.duel.chain.length > 0;
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
  assertLegalWindow(session, response, response.state.waitingFor!);
  return response;
}

function assertStaleResponse(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const stale = applyResponse(session, action);
  expect(stale.ok).toBe(false);
  expect(stale.error).toContain("Response is not currently legal");
  assertLegalWindow(session, stale, stale.state.waitingFor!);
}

function assertStalePreviousWindow(session: ReturnType<typeof createDuel>, action: DuelResponse) {
  const stale = applyResponse(session, { ...action, windowId: action.windowId! - 1 });
  expect(stale.ok).toBe(false);
  expect(stale.error).toContain("Response is not currently legal");
  assertLegalWindow(session, stale, stale.state.waitingFor!);
}

function assertLegalWindow(session: ReturnType<typeof createDuel>, response: ReturnType<typeof applyResponse>, player: 0 | 1): void {
  const windowId = session.state.actionWindowId;
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}

function actionsWithoutWindowToken(actions: DuelAction[]): Array<Omit<DuelAction, "windowToken">> {
  return actions.map((action) => {
    const { windowToken: _windowToken, ...rest } = action;
    return rest;
  });
}

function groupsWithoutWindowToken(groups: DuelLegalActionGroup[]): DuelLegalActionGroup[] {
  return groups.map((group) => ({
    ...group,
    actions: actionsWithoutWindowToken(group.actions) as DuelAction[],
  }));
}

function hasGroupedEffect(
  groups: ReturnType<typeof getGroupedDuelLegalActions>,
  player: 0 | 1,
  effectId: string,
  windowKind: "chainResponse" | "open" | "triggerBucket",
): boolean {
  return groups.some(
    (group) =>
      group.windowKind === windowKind &&
      group.actions.some(
        (action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowKind === windowKind,
      ),
  );
}

function hasGroupedPass(groups: ReturnType<typeof getGroupedDuelLegalActions>, player: 0 | 1): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "chainResponse" &&
      group.actions.some((action) => action.type === "passChain" && action.player === player && action.windowId === group.windowId && action.windowKind === "chainResponse"),
  );
}

function hasGroupedTrigger(
  groups: ReturnType<typeof getGroupedDuelLegalActions>,
  player: 0 | 1,
  effectId: string,
): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "triggerBucket" &&
      group.actions.some(
        (action) => action.type === "activateTrigger" && action.player === player && action.effectId === effectId && action.windowId === group.windowId && action.windowKind === "triggerBucket",
      ),
  );
}
