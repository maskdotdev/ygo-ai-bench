import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
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
    const afterFirstTrigger = applyAndAssert(restoredFirstBucket, firstTrigger!);
    expect(afterFirstTrigger.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(afterFirstTrigger.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-second-held-trigger", eventName: "normalSummoned", eventCardUid: summoned!.uid }),
    ]);
    expect(getDuelLegalActions(restoredFirstBucket, 1).some((action) => action.type === "activateEffect" && action.effectId === "restore-opponent-chain-window-quick")).toBe(false);

    const restoredSecondBucket = restoreDuel(serializeDuel(restoredFirstBucket), createCardReader(cards), restoreRegistry());
    const secondTrigger = getDuelLegalActions(restoredSecondBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-second-held-trigger");
    expect(secondTrigger).toBeDefined();
    const afterSecondTrigger = applyAndAssert(restoredSecondBucket, secondTrigger!);
    expect(afterSecondTrigger.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(afterSecondTrigger.state.pendingTriggers).toEqual([]);
    expect(afterSecondTrigger.state.chain.map((link) => link.effectId)).toEqual(["restore-first-chain-window-trigger", "restore-second-held-trigger"]);

    const restoredChainWindow = restoreDuel(serializeDuel(restoredSecondBucket), createCardReader(cards), restoreRegistry());
    const opponentQuick = getDuelLegalActions(restoredChainWindow, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-opponent-chain-window-quick");
    expect(opponentQuick).toBeDefined();
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
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
    const resolved = applyAndAssert(restoredChainWindow, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(resolved.state.log.some((entry) => entry.detail === "Restored first trigger resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored second trigger resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored opponent chain-window quick resolved")).toBe(true);
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
    const afterFirstTrigger = applyAndAssert(restoredFirstBucket, firstTrigger!);
    expect(afterFirstTrigger.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(afterFirstTrigger.state.chain.map((link) => link.effectId)).toEqual(["restore-first-mandatory-chain-window-trigger"]);
    expect(afterFirstTrigger.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-second-mandatory-held-trigger", eventName: "normalSummoned", eventCardUid: summoned!.uid }),
    ]);
    expect(getDuelLegalActions(restoredFirstBucket, 1).some((action) => action.type === "activateEffect" && action.effectId === "restore-opponent-mandatory-chain-window-quick")).toBe(false);

    const restoredSecondBucket = restoreDuel(serializeDuel(restoredFirstBucket), createCardReader(cards), restoreMandatoryRegistry());
    expect(getDuelLegalActions(restoredSecondBucket, 0).some((action) => action.type === "declineTrigger")).toBe(false);
    const secondTrigger = getDuelLegalActions(restoredSecondBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-second-mandatory-held-trigger");
    expect(secondTrigger).toBeDefined();
    const afterSecondTrigger = applyAndAssert(restoredSecondBucket, secondTrigger!);
    expect(afterSecondTrigger.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [] });
    expect(afterSecondTrigger.state.chain.map((link) => link.effectId)).toEqual(["restore-first-mandatory-chain-window-trigger", "restore-second-mandatory-held-trigger"]);

    const restoredChainWindow = restoreDuel(serializeDuel(restoredSecondBucket), createCardReader(cards), restoreMandatoryRegistry());
    const opponentQuick = getDuelLegalActions(restoredChainWindow, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-opponent-mandatory-chain-window-quick");
    expect(opponentQuick).toBeDefined();
    expect(opponentQuick).toMatchObject({ player: 1, windowKind: "chainResponse" });
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
    const resolved = applyAndAssert(restoredChainWindow, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(resolved.state.log.some((entry) => entry.detail === "Restored first mandatory trigger resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored second mandatory trigger resolved")).toBe(true);
    expect(resolved.state.log.some((entry) => entry.detail === "Restored opponent mandatory chain-window quick resolved")).toBe(true);
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

function assertStaleResponse(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const stale = applyResponse(session, action);
  expect(stale.ok).toBe(false);
  expect(stale.error).toContain("Response is not currently legal");
  expect(stale.state.actionWindowId).toBe(session.state.actionWindowId);
  expect(stale.legalActions).toEqual(getDuelLegalActions(session, stale.state.waitingFor!));
  expect(stale.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, stale.state.waitingFor!));
  expect(stale.legalActionGroups.flatMap((group) => group.actions)).toEqual(stale.legalActions);
}
