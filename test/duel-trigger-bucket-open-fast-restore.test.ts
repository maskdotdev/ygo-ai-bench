import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("trigger bucket open fast restore", () => {
  it("returns restored trigger chains to open-only fast-effect priority after chain resolution", () => {
    const session = createDuel({ seed: 233, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "300"] },
    });
    startDuel(session);

    const summoned = findHandCard(session, 0, "100");
    const turnTrigger = findHandCard(session, 0, "300");
    const turnQuick = findHandCard(session, 0, "500");
    const opponentTrigger = findHandCard(session, 1, "400");
    expect(summoned).toBeDefined();
    expect(turnTrigger).toBeDefined();
    expect(turnQuick).toBeDefined();
    expect(opponentTrigger).toBeDefined();

    registerEffect(session, normalSummonTrigger("restore-open-fast-turn-trigger", turnTrigger!.uid, 0));
    registerEffect(session, normalSummonTrigger("restore-open-fast-opponent-trigger", opponentTrigger!.uid, 1));
    registerEffect(session, openOnlyQuick("restore-open-fast-turn-open-quick", turnQuick!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-open-fast-turn-chain-quick", turnQuick!.uid, 0));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnBucket).pendingTriggerBuckets.map((bucket) => bucket.triggerBucket)).toEqual(["turnOptional", "opponentOptional"]);
    const turnDecline = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-open-fast-turn-trigger");
    expect(turnDecline).toBeDefined();
    const afterTurnDecline = applyAndAssert(restoredTurnBucket, turnDecline!);
    expect(afterTurnDecline.state).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    expect(afterTurnDecline.state.pendingTriggerBuckets.map((bucket) => bucket.triggerBucket)).toEqual(["opponentOptional"]);
    expect(afterTurnDecline.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-open-fast-opponent-trigger"]);
    const staleTurnDecline = applyResponse(restoredTurnBucket, turnDecline!);
    expect(staleTurnDecline.ok).toBe(false);
    expect(staleTurnDecline.error).toContain("Response is not currently legal");
    expect(staleTurnDecline.legalActions).toEqual(getDuelLegalActions(restoredTurnBucket, 1));
    expect(staleTurnDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTurnBucket, 1));

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentBucket)).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    expect(queryPublicState(restoredOpponentBucket).pendingTriggerBuckets.map((bucket) => bucket.triggerBucket)).toEqual(["opponentOptional"]);
    expect(restoredOpponentBucket.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-open-fast-opponent-trigger"]);
    expect(getDuelLegalActions(restoredOpponentBucket, 0)).toEqual([]);
    const opponentActivation = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "activateTrigger" && action.effectId === "restore-open-fast-opponent-trigger");
    expect(opponentActivation).toBeDefined();
    applyAndAssert(restoredOpponentBucket, opponentActivation!);

    const restoredChainWindow = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredChainWindow, 0).some((action) => action.type === "activateEffect" && action.effectId === "restore-open-fast-turn-chain-quick")).toBe(true);
    expect(getDuelLegalActions(restoredChainWindow, 0).some((action) => action.type === "activateEffect" && action.effectId === "restore-open-fast-turn-open-quick")).toBe(false);
    expect(hasGroupedEffect(restoredChainWindow, 0, "restore-open-fast-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredChainWindow, 0, "restore-open-fast-turn-open-quick", "chainResponse")).toBe(false);

    const pass = getDuelLegalActions(restoredChainWindow, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyAndAssert(restoredChainWindow, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-fast-turn-open-quick")).toBe(true);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-fast-turn-chain-quick")).toBe(false);
    expect(hasGroupedEffect(restoredChainWindow, 0, "restore-open-fast-turn-open-quick", "open")).toBe(true);
    expect(hasGroupedEffect(restoredChainWindow, 0, "restore-open-fast-turn-chain-quick", "open")).toBe(false);
    expect(getDuelLegalActions(restoredChainWindow, 1)).toEqual([]);
    expect(restoredChainWindow.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining(["restore-open-fast-opponent-trigger resolved"]));

    const restoredOpenWindow = restoreDuel(serializeDuel(restoredChainWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(getDuelLegalActions(restoredOpenWindow, 0).filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual(["restore-open-fast-turn-open-quick"]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
    expect(getDuelLegalActions(restoredOpenWindow, 1)).toEqual([]);
    const stalePass = applyResponse(restoredChainWindow, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restoredChainWindow, 0));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredChainWindow, 0));
  });

  it("alternates restored trigger-chain fast-effect priority after the first response chains", () => {
    const session = createDuel({ seed: 234, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "300"] },
    });
    startDuel(session);

    const summoned = findHandCard(session, 0, "100");
    const turnTrigger = findHandCard(session, 0, "300");
    const turnQuick = findHandCard(session, 0, "500");
    const opponentTrigger = findHandCard(session, 1, "400");
    const opponentQuick = findHandCard(session, 1, "500");
    expect(summoned).toBeDefined();
    expect(turnTrigger).toBeDefined();
    expect(turnQuick).toBeDefined();
    expect(opponentTrigger).toBeDefined();
    expect(opponentQuick).toBeDefined();

    registerEffect(session, normalSummonTrigger("restore-fast-alt-turn-trigger", turnTrigger!.uid, 0));
    registerEffect(session, normalSummonTrigger("restore-fast-alt-opponent-trigger", opponentTrigger!.uid, 1));
    registerEffect(session, chainOnlyQuick("restore-fast-alt-turn-chain-quick", turnQuick!.uid, 0, true));
    registerEffect(session, openOnlyQuick("restore-fast-alt-turn-open-quick", turnQuick!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-fast-alt-opponent-chain-quick", opponentQuick!.uid, 1, true));
    registerEffect(session, openOnlyQuick("restore-fast-alt-opponent-open-quick", opponentQuick!.uid, 1));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    const turnDecline = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-fast-alt-turn-trigger");
    expect(turnDecline).toBeDefined();
    applyAndAssert(restoredTurnBucket, turnDecline!);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreRegistry());
    const opponentActivation = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "activateTrigger" && action.effectId === "restore-fast-alt-opponent-trigger");
    expect(opponentActivation).toBeDefined();
    applyAndAssert(restoredOpponentBucket, opponentActivation!);

    const restoredTurnResponse = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnResponse)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    const turnChain = getDuelLegalActions(restoredTurnResponse, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-fast-alt-turn-chain-quick");
    expect(turnChain).toBeDefined();
    expect(hasGroupedEffect(restoredTurnResponse, 0, "restore-fast-alt-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredTurnResponse, 0, "restore-fast-alt-turn-open-quick", "chainResponse")).toBe(false);
    const staleBeforeTurnChain = applyResponse(restoredTurnResponse, { ...turnChain!, windowId: turnChain!.windowId! - 1 });
    expect(staleBeforeTurnChain.ok).toBe(false);
    expect(staleBeforeTurnChain.error).toContain("Response is not currently legal");
    expect(staleBeforeTurnChain.legalActions).toEqual(getDuelLegalActions(restoredTurnResponse, 0));
    expect(staleBeforeTurnChain.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTurnResponse, 0));

    const turnChained = applyAndAssert(restoredTurnResponse, turnChain!);
    expect(turnChained.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(turnChained.state.chain.map((link) => link.effectId)).toEqual(["restore-fast-alt-opponent-trigger", "restore-fast-alt-turn-chain-quick"]);
    expect(turnChained.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-fast-alt-opponent-chain-quick")).toBe(true);
    expect(turnChained.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-fast-alt-opponent-open-quick")).toBe(false);

    const restoredOpponentResponse = restoreDuel(serializeDuel(restoredTurnResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentResponse)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredOpponentResponse, 0)).toEqual([]);
    expect(hasGroupedEffect(restoredOpponentResponse, 1, "restore-fast-alt-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentResponse, 1, "restore-fast-alt-opponent-open-quick", "chainResponse")).toBe(false);
    const opponentPass = getDuelLegalActions(restoredOpponentResponse, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const resolved = applyAndAssert(restoredOpponentResponse, opponentPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(resolved.legalActions.filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual(["restore-fast-alt-turn-open-quick"]);
    expect(getDuelLegalActions(restoredOpponentResponse, 1)).toEqual([]);
    const staleTurnChain = applyResponse(restoredTurnResponse, turnChain!);
    expect(staleTurnChain.ok).toBe(false);
    expect(staleTurnChain.error).toContain("Response is not currently legal");
  });

  it("resolves restored trigger-chain fast-effect alternation after the opponent chains", () => {
    const session = createDuel({ seed: 235, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "300"] },
    });
    startDuel(session);

    const summoned = findHandCard(session, 0, "100");
    const turnTrigger = findHandCard(session, 0, "300");
    const turnQuick = findHandCard(session, 0, "500");
    const opponentTrigger = findHandCard(session, 1, "400");
    const opponentQuick = findHandCard(session, 1, "500");
    expect(summoned).toBeDefined();
    expect(turnTrigger).toBeDefined();
    expect(turnQuick).toBeDefined();
    expect(opponentTrigger).toBeDefined();
    expect(opponentQuick).toBeDefined();

    registerEffect(session, normalSummonTrigger("restore-fast-resolve-turn-trigger", turnTrigger!.uid, 0));
    registerEffect(session, normalSummonTrigger("restore-fast-resolve-opponent-trigger", opponentTrigger!.uid, 1));
    registerEffect(session, chainOnlyQuick("restore-fast-resolve-turn-chain-quick", turnQuick!.uid, 0, true));
    registerEffect(session, openOnlyQuick("restore-fast-resolve-turn-open-quick", turnQuick!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-fast-resolve-opponent-chain-quick", opponentQuick!.uid, 1, true));
    registerEffect(session, openOnlyQuick("restore-fast-resolve-opponent-open-quick", opponentQuick!.uid, 1));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    const turnDecline = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-fast-resolve-turn-trigger");
    expect(turnDecline).toBeDefined();
    applyAndAssert(restoredTurnBucket, turnDecline!);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreRegistry());
    const opponentTriggerAction = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "activateTrigger" && action.effectId === "restore-fast-resolve-opponent-trigger");
    expect(opponentTriggerAction).toBeDefined();
    applyAndAssert(restoredOpponentBucket, opponentTriggerAction!);

    const restoredTurnResponse = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), restoreRegistry());
    const turnChain = getDuelLegalActions(restoredTurnResponse, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-fast-resolve-turn-chain-quick");
    expect(turnChain).toBeDefined();
    applyAndAssert(restoredTurnResponse, turnChain!);

    const restoredOpponentResponse = restoreDuel(serializeDuel(restoredTurnResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentResponse)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    const opponentChain = getDuelLegalActions(restoredOpponentResponse, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-fast-resolve-opponent-chain-quick");
    expect(opponentChain).toBeDefined();
    expect(hasGroupedEffect(restoredOpponentResponse, 1, "restore-fast-resolve-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentResponse, 1, "restore-fast-resolve-opponent-open-quick", "chainResponse")).toBe(false);
    const staleBeforeOpponentChain = applyResponse(restoredOpponentResponse, { ...opponentChain!, windowId: opponentChain!.windowId! - 1 });
    expect(staleBeforeOpponentChain.ok).toBe(false);
    expect(staleBeforeOpponentChain.error).toContain("Response is not currently legal");
    expect(staleBeforeOpponentChain.legalActions).toEqual(getDuelLegalActions(restoredOpponentResponse, 1));
    expect(staleBeforeOpponentChain.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentResponse, 1));

    const resolved = applyAndAssert(restoredOpponentResponse, opponentChain!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(resolved.legalActions.filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual(["restore-fast-resolve-turn-open-quick"]);
    expect(getDuelLegalActions(restoredOpponentResponse, 1)).toEqual([]);
    expect(restoredOpponentResponse.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-fast-resolve-opponent-chain-quick resolved",
      "restore-fast-resolve-turn-chain-quick resolved",
      "restore-fast-resolve-opponent-trigger resolved",
    ]));

    const restoredOpenWindow = restoreDuel(serializeDuel(restoredOpponentResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(getDuelLegalActions(restoredOpenWindow, 0).filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual(["restore-fast-resolve-turn-open-quick"]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
    expect(getDuelLegalActions(restoredOpenWindow, 1)).toEqual([]);
    const staleOpponentChain = applyResponse(restoredOpponentResponse, opponentChain!);
    expect(staleOpponentChain.ok).toBe(false);
    expect(staleOpponentChain.error).toContain("Response is not currently legal");
    expect(staleOpponentChain.legalActions).toEqual(getDuelLegalActions(restoredOpponentResponse, 0));
    expect(staleOpponentChain.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentResponse, 0));
  });
});

function normalSummonTrigger(id: string, sourceUid: string, controller: 0 | 1): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "trigger",
    triggerEvent: "normalSummoned",
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
    "restore-open-fast-turn-trigger": restoreLoggedEffect,
    "restore-open-fast-opponent-trigger": restoreLoggedEffect,
    "restore-open-fast-turn-open-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
    "restore-open-fast-turn-chain-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-fast-alt-turn-trigger": restoreLoggedEffect,
    "restore-fast-alt-opponent-trigger": restoreLoggedEffect,
    "restore-fast-alt-turn-chain-quick": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-fast-alt-turn-open-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
    "restore-fast-alt-opponent-chain-quick": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-fast-alt-opponent-open-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
    "restore-fast-resolve-turn-trigger": restoreLoggedEffect,
    "restore-fast-resolve-opponent-trigger": restoreLoggedEffect,
    "restore-fast-resolve-turn-chain-quick": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-fast-resolve-turn-open-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
    "restore-fast-resolve-opponent-chain-quick": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-fast-resolve-opponent-open-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
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
