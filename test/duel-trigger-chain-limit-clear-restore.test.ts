import { describe, expect, it } from "vitest";
import { addDuelChainLimit, applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { ChainLimit, DuelEffectDefinition } from "#duel/types.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

const TRIGGER_LIMIT_CLEAR_TURN_ONLY_CHAIN_LIMIT_KEY = "restore-trigger-limit-clear-turn-only-chain-limit";

describe("trigger chain limit clear restore", () => {
  it("restores opponent and trigger-player windows after one-chain limits clear", () => {
    const session = createDuel({ seed: 618, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "350", "400"] },
      1: { main: ["500", "600", "700", "900", "900"] },
    });
    startDuel(session);

    const summoned = findPublicCard(session, 0, "hand", "100");
    const trigger = findPublicCard(session, 0, "hand", "200");
    const firstResponse = findPublicCard(session, 0, "hand", "300");
    const secondResponse = findPublicCard(session, 0, "hand", "350");
    const turnOpen = findPublicCard(session, 0, "hand", "400");
    const limiter = findPublicCard(session, 1, "hand", "500");
    const opponentResponse = findPublicCard(session, 1, "hand", "600");
    const opponentOpen = findPublicCard(session, 1, "hand", "700");
    expect(summoned).toBeDefined();
    expect(trigger).toBeDefined();
    expect(firstResponse).toBeDefined();
    expect(secondResponse).toBeDefined();
    expect(turnOpen).toBeDefined();
    expect(limiter).toBeDefined();
    expect(opponentResponse).toBeDefined();
    expect(opponentOpen).toBeDefined();

    registerEffect(session, normalSummonTrigger("restore-trigger-limit-clear-success", trigger!.uid, 0, false));
    registerEffect(session, chainOnlyQuick("restore-trigger-limit-clear-first-response", firstResponse!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-trigger-limit-clear-second-response", secondResponse!.uid, 0));
    registerEffect(session, openOnlyQuick("restore-trigger-limit-clear-open", turnOpen!.uid, 0));
    registerEffect(session, chainOnlyQuickWithTurnLimit("restore-trigger-limit-clear-opponent-limiter", limiter!.uid, 1, true));
    registerEffect(session, chainOnlyQuick("restore-trigger-limit-clear-opponent-response", opponentResponse!.uid, 1, true));
    registerEffect(session, openOnlyQuick("restore-trigger-limit-clear-opponent-open", opponentOpen!.uid, 1));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    const restoredBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    const triggerAction = findEffectAction(restoredBucket, 0, "restore-trigger-limit-clear-success", "activateTrigger");
    expect(triggerAction).toBeDefined();
    applyAndAssert(restoredBucket, triggerAction!);

    const limiterAction = findEffectAction(restoredBucket, 1, "restore-trigger-limit-clear-opponent-limiter");
    expect(limiterAction).toBeDefined();
    applyAndAssert(restoredBucket, limiterAction!);

    const restoredLimitedWindow = restoreDuel(serializeDuel(restoredBucket), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restoredLimitedWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restoredLimitedWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-trigger-limit-clear-success",
      "restore-trigger-limit-clear-opponent-limiter",
    ]);
    expect(restoredLimitedWindow.state.chainLimits).toHaveLength(1);
    expect(restoredLimitedWindow.state.chainLimits[0]).toMatchObject({
      registryKey: TRIGGER_LIMIT_CLEAR_TURN_ONLY_CHAIN_LIMIT_KEY,
      untilChainEnd: false,
      expiresAtChainLength: 2,
    });
    expect(effectIds(restoredLimitedWindow, 0)).toEqual(["restore-trigger-limit-clear-first-response", "restore-trigger-limit-clear-second-response"]);
    expect(getDuelLegalActions(restoredLimitedWindow, 1)).toEqual([]);
    expect(hasGroupedEffect(restoredLimitedWindow, 0, "restore-trigger-limit-clear-first-response", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredLimitedWindow, 0, "restore-trigger-limit-clear-second-response", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredLimitedWindow, 0, "restore-trigger-limit-clear-open", "chainResponse")).toBe(false);
    expect(hasGroupedEffect(restoredLimitedWindow, 1, "restore-trigger-limit-clear-opponent-response", "chainResponse")).toBe(false);

    const firstChain = findEffectAction(restoredLimitedWindow, 0, "restore-trigger-limit-clear-first-response");
    expect(firstChain).toBeDefined();
    applyAndAssert(restoredLimitedWindow, firstChain!);

    const restoredClearedOpponentWindow = restoreDuel(serializeDuel(restoredLimitedWindow), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restoredClearedOpponentWindow)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(restoredClearedOpponentWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-trigger-limit-clear-success",
      "restore-trigger-limit-clear-opponent-limiter",
      "restore-trigger-limit-clear-first-response",
    ]);
    expect(restoredClearedOpponentWindow.state.chainLimits).toEqual([]);
    expect(effectIds(restoredClearedOpponentWindow, 1)).toEqual(["restore-trigger-limit-clear-opponent-response"]);
    expect(getDuelLegalActions(restoredClearedOpponentWindow, 0)).toEqual([]);
    expect(hasGroupedEffect(restoredClearedOpponentWindow, 1, "restore-trigger-limit-clear-opponent-response", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredClearedOpponentWindow, 1, "restore-trigger-limit-clear-opponent-limiter", "chainResponse")).toBe(false);
    expect(hasGroupedEffect(restoredClearedOpponentWindow, 1, "restore-trigger-limit-clear-opponent-open", "chainResponse")).toBe(false);

    const opponentChain = findEffectAction(restoredClearedOpponentWindow, 1, "restore-trigger-limit-clear-opponent-response");
    expect(opponentChain).toBeDefined();
    applyAndAssert(restoredClearedOpponentWindow, opponentChain!);

    const restoredReturnedTriggerWindow = restoreDuel(serializeDuel(restoredClearedOpponentWindow), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restoredReturnedTriggerWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restoredReturnedTriggerWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-trigger-limit-clear-success",
      "restore-trigger-limit-clear-opponent-limiter",
      "restore-trigger-limit-clear-first-response",
      "restore-trigger-limit-clear-opponent-response",
    ]);
    expect(restoredReturnedTriggerWindow.state.chainLimits).toEqual([]);
    expect(effectIds(restoredReturnedTriggerWindow, 0)).toEqual(["restore-trigger-limit-clear-second-response"]);
    expect(getDuelLegalActions(restoredReturnedTriggerWindow, 1)).toEqual([]);
    expect(hasGroupedEffect(restoredReturnedTriggerWindow, 0, "restore-trigger-limit-clear-first-response", "chainResponse")).toBe(false);
    expect(hasGroupedEffect(restoredReturnedTriggerWindow, 0, "restore-trigger-limit-clear-second-response", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredReturnedTriggerWindow, 0, "restore-trigger-limit-clear-open", "chainResponse")).toBe(false);

    const pass = getDuelLegalActions(restoredReturnedTriggerWindow, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(restoredReturnedTriggerWindow, pass!);
    expect(queryPublicState(restoredReturnedTriggerWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredReturnedTriggerWindow.state.chainLimits).toEqual([]);
    expect(effectIds(restoredReturnedTriggerWindow, 0)).toEqual(["restore-trigger-limit-clear-open"]);
    expect(effectIds(restoredReturnedTriggerWindow, 1)).toEqual([]);
    expect(restoredReturnedTriggerWindow.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-trigger-limit-clear-opponent-response resolved",
      "restore-trigger-limit-clear-first-response resolved",
      "restore-trigger-limit-clear-opponent-limiter resolved",
      "restore-trigger-limit-clear-success resolved",
    ]));
    expect(restoredReturnedTriggerWindow.state.log.map((entry) => entry.detail)).not.toContain("restore-trigger-limit-clear-second-response resolved");
  });
});

function normalSummonTrigger(id: string, sourceUid: string, controller: 0 | 1, optional = true): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "trigger",
    triggerEvent: "normalSummoned",
    ...(optional ? {} : { optional: false }),
    range: ["hand"],
    operation(ctx) {
      ctx.log(`${id} resolved`);
    },
  };
}

function openOnlyQuick(id: string, sourceUid: string, controller: 0 | 1): DuelEffectDefinition {
  return quickEffect(id, sourceUid, controller, 0);
}

function chainOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return quickEffect(id, sourceUid, controller, 1, oncePerTurn);
}

function chainOnlyQuickWithTurnLimit(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyChainLimit());
      return true;
    },
  };
}

function quickEffect(id: string, sourceUid: string, controller: 0 | 1, minimumChainLength: number, oncePerTurn = false): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "quick",
    ...(oncePerTurn ? { oncePerTurn: true } : {}),
    range: ["hand"],
    operation(ctx) {
      ctx.log(`${id} resolved`);
    },
    canActivate(ctx) {
      return minimumChainLength === 0 ? ctx.duel.chain.length === 0 : ctx.duel.chain.length > 0;
    },
  };
}

function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-trigger-limit-clear-success": restoreLoggedEffect,
    "restore-trigger-limit-clear-first-response": restoreChainOnlyQuick(true),
    "restore-trigger-limit-clear-second-response": restoreChainOnlyQuick(),
    "restore-trigger-limit-clear-open": restoreOpenOnlyQuick,
    "restore-trigger-limit-clear-opponent-limiter": (effect) => ({
      ...restoreChainOnlyQuick(true)(effect),
      target(ctx) {
        if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyChainLimit());
        return true;
      },
    }),
    "restore-trigger-limit-clear-opponent-response": restoreChainOnlyQuick(true),
    "restore-trigger-limit-clear-opponent-open": restoreOpenOnlyQuick,
  };
}

function restoreLoggedEffect(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...effect,
    operation(ctx) {
      ctx.log(`${effect.id} resolved`);
    },
  };
}

function restoreOpenOnlyQuick(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...restoreLoggedEffect(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

function restoreChainOnlyQuick(oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreLoggedEffect({ ...effect, ...(oncePerTurn ? { oncePerTurn: true } : {}) }),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  });
}

function restoreChainLimitRegistry(): Record<string, (limit: ChainLimit) => ChainLimit> {
  return {
    [TRIGGER_LIMIT_CLEAR_TURN_ONLY_CHAIN_LIMIT_KEY]: restoreTurnOnlyChainLimit,
  };
}

function restoreTurnOnlyChainLimit(limit: ChainLimit): ChainLimit {
  return {
    ...limit,
    allows(_effect, player) {
      return player === 0;
    },
  };
}

function turnOnlyChainLimit(): Omit<ChainLimit, "expiresAtChainLength"> {
  return {
    registryKey: TRIGGER_LIMIT_CLEAR_TURN_ONLY_CHAIN_LIMIT_KEY,
    untilChainEnd: false,
    allows(_effect, player) {
      return player === 0;
    },
  };
}

function findEffectAction(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string, type: "activateEffect" | "activateTrigger" = "activateEffect") {
  return getDuelLegalActions(session, player).find((action) => action.type === type && action.effectId === effectId);
}

function effectIds(session: ReturnType<typeof createDuel>, player: 0 | 1): string[] {
  return getDuelLegalActions(session, player)
    .filter((action) => action.type === "activateEffect")
    .map((action) => action.effectId);
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function hasGroupedEffect(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string, windowKind: "chainResponse" | "open"): boolean {
  return getGroupedDuelLegalActions(session, player).some((group) =>
    group.windowKind === windowKind && group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowKind === windowKind),
  );
}
