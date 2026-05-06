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
    const turnDecline = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-open-fast-turn-trigger");
    expect(turnDecline).toBeDefined();
    applyAndAssert(restoredTurnBucket, turnDecline!);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentBucket)).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
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

function chainOnlyQuick(id: string, sourceUid: string, controller: 0 | 1): DuelEffectDefinition {
  return quickEffect(id, sourceUid, controller, 1);
}

function quickEffect(id: string, sourceUid: string, controller: 0 | 1, minimumChainLength: number): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "quick",
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
