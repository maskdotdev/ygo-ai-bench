import { describe, expect, it } from "vitest";
import { addDuelChainLimit, applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { ChainLimit, DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

const TRIGGER_FOLLOWUP_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY = "restore-trigger-followup-turn-only-until-chain-end-limit";

describe("trigger chain limit followup restore", () => {
  it("restores continued trigger-player responses under until-chain-end limits", () => {
    const session = createDuel({ seed: 619, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500", "600", "700", "200"] },
      1: { main: ["500", "600", "700", "400", "400", "400"] },
    });
    startDuel(session);

    const summoned = findHandCard(session, 0, "100");
    const trigger = findHandCard(session, 0, "300");
    const firstResponse = findHandCard(session, 0, "500");
    const secondResponse = findHandCard(session, 0, "600");
    const thirdResponse = findHandCard(session, 0, "700");
    const turnOpen = findHandCard(session, 0, "200");
    const limiter = findHandCard(session, 1, "500");
    const opponentBlocked = findHandCard(session, 1, "600");
    const opponentOpen = findHandCard(session, 1, "700");
    expect(summoned).toBeDefined();
    expect(trigger).toBeDefined();
    expect(firstResponse).toBeDefined();
    expect(secondResponse).toBeDefined();
    expect(thirdResponse).toBeDefined();
    expect(turnOpen).toBeDefined();
    expect(limiter).toBeDefined();
    expect(opponentBlocked).toBeDefined();
    expect(opponentOpen).toBeDefined();

    registerEffect(session, normalSummonTrigger("restore-trigger-followup-success", trigger!.uid, 0, false));
    registerEffect(session, chainOnlyQuick("restore-trigger-followup-first-response", firstResponse!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-trigger-followup-second-response", secondResponse!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-trigger-followup-third-response", thirdResponse!.uid, 0, true));
    registerEffect(session, openOnlyQuick("restore-trigger-followup-open", turnOpen!.uid, 0));
    registerEffect(session, chainOnlyQuickWithTurnUntilLimit("restore-trigger-followup-opponent-limiter", limiter!.uid, 1, true));
    registerEffect(session, chainOnlyQuick("restore-trigger-followup-opponent-blocked", opponentBlocked!.uid, 1));
    registerEffect(session, openOnlyQuick("restore-trigger-followup-opponent-open", opponentOpen!.uid, 1));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    const restoredBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    const triggerAction = getDuelLegalActions(restoredBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-trigger-followup-success");
    expect(triggerAction).toBeDefined();
    applyAndAssert(restoredBucket, triggerAction!);

    const limiterAction = getDuelLegalActions(restoredBucket, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-trigger-followup-opponent-limiter");
    expect(limiterAction).toBeDefined();
    applyAndAssert(restoredBucket, limiterAction!);

    const firstChain = getDuelLegalActions(restoredBucket, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-trigger-followup-first-response");
    expect(firstChain).toBeDefined();
    applyAndAssert(restoredBucket, firstChain!);

    const restoredFirstFollowup = restoreDuel(serializeDuel(restoredBucket), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restoredFirstFollowup)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restoredFirstFollowup.state.chainLimits).toHaveLength(1);
    expect(restoredFirstFollowup.state.chainLimits[0]).toMatchObject({
      registryKey: TRIGGER_FOLLOWUP_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY,
      untilChainEnd: true,
    });
    expect(getDuelLegalActions(restoredFirstFollowup, 1)).toEqual([]);
    expect(hasGroupedEffect(restoredFirstFollowup, 0, "restore-trigger-followup-second-response", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredFirstFollowup, 0, "restore-trigger-followup-third-response", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredFirstFollowup, 0, "restore-trigger-followup-open", "chainResponse")).toBe(false);
    expect(hasGroupedEffect(restoredFirstFollowup, 1, "restore-trigger-followup-opponent-blocked", "chainResponse")).toBe(false);

    const secondChain = getDuelLegalActions(restoredFirstFollowup, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-trigger-followup-second-response");
    expect(secondChain).toBeDefined();
    const continuedWindow = applyAndAssert(restoredFirstFollowup, secondChain!);
    expect(continuedWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(continuedWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-trigger-followup-success",
      "restore-trigger-followup-opponent-limiter",
      "restore-trigger-followup-first-response",
      "restore-trigger-followup-second-response",
    ]);
    expect(restoredFirstFollowup.state.chainLimits).toHaveLength(1);
    expect(restoredFirstFollowup.state.chainLimits[0]).toMatchObject({
      registryKey: TRIGGER_FOLLOWUP_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY,
      untilChainEnd: true,
    });
    expect(continuedWindow.legalActions.filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual(["restore-trigger-followup-third-response"]);
    expect(getDuelLegalActions(restoredFirstFollowup, 1)).toEqual([]);

    const restoredContinuedWindow = restoreDuel(serializeDuel(restoredFirstFollowup), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restoredContinuedWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restoredContinuedWindow.state.chainLimits).toHaveLength(1);
    expect(restoredContinuedWindow.state.chainLimits[0]).toMatchObject({
      registryKey: TRIGGER_FOLLOWUP_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY,
      untilChainEnd: true,
    });
    expect(getDuelLegalActions(restoredContinuedWindow, 0)).toEqual(getDuelLegalActions(restoredFirstFollowup, 0));
    expect(getGroupedDuelLegalActions(restoredContinuedWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredFirstFollowup, 0));
    expect(getDuelLegalActions(restoredContinuedWindow, 1)).toEqual([]);

    const pass = getDuelLegalActions(restoredContinuedWindow, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyAndAssert(restoredContinuedWindow, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredContinuedWindow.state.chainLimits).toEqual([]);
    expect(getDuelLegalActions(restoredContinuedWindow, 0).filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual(["restore-trigger-followup-open"]);
    expect(restoredContinuedWindow.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-trigger-followup-second-response resolved",
      "restore-trigger-followup-first-response resolved",
      "restore-trigger-followup-opponent-limiter resolved",
      "restore-trigger-followup-success resolved",
    ]));
    expect(restoredContinuedWindow.state.log.map((entry) => entry.detail)).not.toContain("restore-trigger-followup-third-response resolved");
    expect(restoredContinuedWindow.state.log.map((entry) => entry.detail)).not.toContain("restore-trigger-followup-opponent-blocked resolved");
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

function chainOnlyQuickWithTurnUntilLimit(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyUntilChainEndLimit());
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
    "restore-trigger-followup-success": restoreLoggedEffect,
    "restore-trigger-followup-first-response": restoreChainOnlyQuick(true),
    "restore-trigger-followup-second-response": restoreChainOnlyQuick(true),
    "restore-trigger-followup-third-response": restoreChainOnlyQuick(true),
    "restore-trigger-followup-open": restoreOpenOnlyQuick,
    "restore-trigger-followup-opponent-limiter": (effect) => ({
      ...restoreChainOnlyQuick(true)(effect),
      target(ctx) {
        if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyUntilChainEndLimit());
        return true;
      },
    }),
    "restore-trigger-followup-opponent-blocked": restoreChainOnlyQuick(),
    "restore-trigger-followup-opponent-open": restoreOpenOnlyQuick,
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
    [TRIGGER_FOLLOWUP_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY]: restoreTurnOnlyChainLimit,
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

function turnOnlyUntilChainEndLimit(): Omit<ChainLimit, "expiresAtChainLength"> {
  return {
    registryKey: TRIGGER_FOLLOWUP_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY,
    untilChainEnd: true,
    allows(_effect, player) {
      return player === 0;
    },
  };
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function findHandCard(session: ReturnType<typeof createDuel>, controller: 0 | 1, code: string) {
  return queryPublicState(session).cards.find((card) => card.controller === controller && card.location === "hand" && card.code === code);
}

function hasGroupedEffect(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string, windowKind: "chainResponse" | "open"): boolean {
  return getGroupedDuelLegalActions(session, player).some((group) =>
    group.windowKind === windowKind && group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowKind === windowKind),
  );
}
