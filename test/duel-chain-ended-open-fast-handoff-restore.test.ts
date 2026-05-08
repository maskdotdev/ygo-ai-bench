import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition, DuelLocation, DuelState } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("chain-ended open fast handoff restore", () => {
  it("restores post-chainEnded open fast-effect pass handoff windows", () => {
    const session = createDuel({ seed: 249, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400", "600", "700"] },
      1: { main: ["500"] },
    });
    startDuel(session);

    const starter = findHandCard(session, 0, "100");
    const cleanup = findHandCard(session, 0, "300");
    const openQuick = findHandCard(session, 0, "400");
    const turnChain = findHandCard(session, 0, "600");
    const extraOpenQuick = findHandCard(session, 0, "700");
    const opponentChain = findHandCard(session, 1, "500");
    expect(starter).toBeDefined();
    expect(cleanup).toBeDefined();
    expect(openQuick).toBeDefined();
    expect(turnChain).toBeDefined();
    expect(extraOpenQuick).toBeDefined();
    expect(opponentChain).toBeDefined();
    moveDuelCard(session.state, turnChain!.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentChain!.uid, "graveyard", 1);

    registerEffect(session, loggedEffect("restore-chain-ended-handoff-starter", starter!.uid, 0, "ignition"));
    registerEffect(session, cleanupTrigger("restore-chain-ended-handoff-cleanup", cleanup!.uid));
    registerEffect(session, openOnlyQuick("restore-chain-ended-handoff-open", openQuick!.uid, 0, true));
    registerEffect(session, openOnlyQuick("restore-chain-ended-handoff-extra-open", extraOpenQuick!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-chain-ended-handoff-turn-chain", turnChain!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-ended-handoff-opponent-chain", opponentChain!.uid, 1, true));

    const starterAction = findEffectAction(session, 0, "restore-chain-ended-handoff-starter");
    expect(starterAction).toBeDefined();
    const triggerBucket = applyAndAssert(session, starterAction!);
    expect(triggerBucket.state).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", chain: [] });

    const cleanupAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-chain-ended-handoff-cleanup");
    expect(cleanupAction).toBeDefined();
    const postChainEndedOpen = applyAndAssert(session, cleanupAction!);
    expect(postChainEndedOpen.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(findPublicCard(session, 0, "600", "hand")).toBeDefined();
    expect(findPublicCard(session, 1, "500", "hand")).toBeDefined();
    expect(hasGroupedEffect(postChainEndedOpen.legalActionGroups, 0, "restore-chain-ended-handoff-open", "open")).toBe(true);
    expect(hasGroupedEffect(postChainEndedOpen.legalActionGroups, 0, "restore-chain-ended-handoff-turn-chain", "open")).toBe(false);
    expect(getDuelLegalActions(session, 1)).toEqual([]);

    const restoredOpen = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpen)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(getDuelLegalActions(restoredOpen, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restoredOpen, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(getDuelLegalActions(restoredOpen, 1)).toEqual([]);

    const restoredOpenQuick = findEffectAction(restoredOpen, 0, "restore-chain-ended-handoff-open");
    expect(restoredOpenQuick).toBeDefined();
    const opponentWindow = applyAndAssert(restoredOpen, restoredOpenQuick!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(opponentWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-ended-handoff-open"]);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-chain-ended-handoff-opponent-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 0, "restore-chain-ended-handoff-turn-chain", "chainResponse")).toBe(false);

    const restoredOpponentWindow = restoreDuel(serializeDuel(restoredOpen), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentWindow)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredOpponentWindow, 1)).toEqual(getDuelLegalActions(restoredOpen, 1));
    expect(getGroupedDuelLegalActions(restoredOpponentWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredOpen, 1));

    const opponentPass = getDuelLegalActions(restoredOpponentWindow, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const turnReturnWindow = applyAndAssert(restoredOpponentWindow, opponentPass!);
    expect(turnReturnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restoredOpponentWindow.state.chainPasses).toEqual([1]);
    expect(getDuelLegalActions(restoredOpponentWindow, 1)).toEqual([]);
    expect(hasGroupedEffect(turnReturnWindow.legalActionGroups, 0, "restore-chain-ended-handoff-turn-chain", "chainResponse")).toBe(true);
    expect(hasGroupedPass(turnReturnWindow.legalActionGroups, 0)).toBe(true);

    const restoredTurnWindow = restoreDuel(serializeDuel(restoredOpponentWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restoredTurnWindow.state.chainPasses).toEqual([1]);
    expect(getDuelLegalActions(restoredTurnWindow, 0)).toEqual(getDuelLegalActions(restoredOpponentWindow, 0));
    expect(getGroupedDuelLegalActions(restoredTurnWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredOpponentWindow, 0));

    const staleOpponentPass = applyResponse(restoredTurnWindow, opponentPass!);
    expect(staleOpponentPass.ok).toBe(false);
    expect(staleOpponentPass.error).toContain("Response is not currently legal");
    expect(staleOpponentPass.legalActions).toEqual(getDuelLegalActions(restoredTurnWindow, 0));
    expect(staleOpponentPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTurnWindow, 0));

    const turnChainAction = findEffectAction(restoredTurnWindow, 0, "restore-chain-ended-handoff-turn-chain");
    expect(turnChainAction).toBeDefined();

    const forgedReturnedOpenOnly = applyResponse(restoredTurnWindow, {
      type: "activateEffect",
      player: 0,
      uid: extraOpenQuick!.uid,
      effectId: "restore-chain-ended-handoff-extra-open",
      label: "Forge post-chainEnded open-only quick into returned chain response",
      windowId: turnChainAction!.windowId,
      windowKind: turnChainAction!.windowKind,
      windowToken: turnChainAction!.windowToken,
    });
    expect(forgedReturnedOpenOnly.ok).toBe(false);
    expect(forgedReturnedOpenOnly.error).toContain("Response is not currently legal");
    expect(forgedReturnedOpenOnly.legalActions).toEqual(getDuelLegalActions(restoredTurnWindow, 0));
    expect(forgedReturnedOpenOnly.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTurnWindow, 0));
    expect(restoredTurnWindow.state.log.map((entry) => entry.detail)).not.toContain("restore-chain-ended-handoff-extra-open resolved");

    const opponentFollowupWindow = applyAndAssert(restoredTurnWindow, turnChainAction!);
    expect(opponentFollowupWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(opponentFollowupWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-chain-ended-handoff-open",
      "restore-chain-ended-handoff-turn-chain",
    ]);
    expect(restoredTurnWindow.state.chainPasses).toEqual([]);
    expect(hasGroupedEffect(opponentFollowupWindow.legalActionGroups, 1, "restore-chain-ended-handoff-opponent-chain", "chainResponse")).toBe(true);
  });

  it("restores post-chainEnded pass handoffs through final pass resolution", () => {
    const session = createDuel({ seed: 250, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400", "600", "700"] },
      1: { main: ["500"] },
    });
    startDuel(session);

    const starter = findHandCard(session, 0, "100");
    const cleanup = findHandCard(session, 0, "300");
    const openQuick = findHandCard(session, 0, "400");
    const turnChain = findHandCard(session, 0, "600");
    const opponentChain = findHandCard(session, 1, "500");
    expect(starter).toBeDefined();
    expect(cleanup).toBeDefined();
    expect(openQuick).toBeDefined();
    expect(turnChain).toBeDefined();
    expect(opponentChain).toBeDefined();
    moveDuelCard(session.state, turnChain!.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentChain!.uid, "graveyard", 1);

    registerEffect(session, loggedEffect("restore-chain-ended-pass-resolve-starter", starter!.uid, 0, "ignition"));
    registerEffect(session, cleanupTrigger("restore-chain-ended-pass-resolve-cleanup", cleanup!.uid));
    registerEffect(session, openOnlyQuick("restore-chain-ended-pass-resolve-open", openQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-ended-pass-resolve-turn-chain", turnChain!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-ended-pass-resolve-opponent-chain", opponentChain!.uid, 1, true));

    const starterAction = findEffectAction(session, 0, "restore-chain-ended-pass-resolve-starter");
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);

    const cleanupAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-chain-ended-pass-resolve-cleanup");
    expect(cleanupAction).toBeDefined();
    applyAndAssert(session, cleanupAction!);

    const openAction = findEffectAction(session, 0, "restore-chain-ended-pass-resolve-open");
    expect(openAction).toBeDefined();
    const opponentWindow = applyAndAssert(session, openAction!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(opponentWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-ended-pass-resolve-open"]);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-chain-ended-pass-resolve-opponent-chain", "chainResponse")).toBe(true);
    expect(hasGroupedPass(opponentWindow.legalActionGroups, 1)).toBe(true);

    const opponentPass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const turnWindow = applyAndAssert(session, opponentPass!);
    expect(turnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(session.state.chainPasses).toEqual([1]);
    expect(getDuelLegalActions(session, 1)).toEqual([]);
    expect(hasGroupedEffect(turnWindow.legalActionGroups, 0, "restore-chain-ended-pass-resolve-turn-chain", "chainResponse")).toBe(true);
    expect(hasGroupedPass(turnWindow.legalActionGroups, 0)).toBe(true);

    const restoredTurnWindow = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restoredTurnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-ended-pass-resolve-open"]);
    expect(restoredTurnWindow.state.chainPasses).toEqual([1]);
    expect(getDuelLegalActions(restoredTurnWindow, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredTurnWindow, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restoredTurnWindow, 0)).toEqual(getGroupedDuelLegalActions(session, 0));

    const staleOpponentPass = applyResponse(restoredTurnWindow, opponentPass!);
    expect(staleOpponentPass.ok).toBe(false);
    expect(staleOpponentPass.error).toContain("Response is not currently legal");
    expect(staleOpponentPass.legalActions).toEqual(getDuelLegalActions(restoredTurnWindow, 0));
    expect(staleOpponentPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTurnWindow, 0));

    const turnPass = getDuelLegalActions(restoredTurnWindow, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    const resolved = applyAndAssert(restoredTurnWindow, turnPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredTurnWindow.state.chainPasses).toEqual([]);
    expect(restoredTurnWindow.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-chain-ended-pass-resolve-open resolved",
      "restore-chain-ended-pass-resolve-cleanup resolved",
      "restore-chain-ended-pass-resolve-starter resolved",
    ]));
    expect(restoredTurnWindow.state.log.map((entry) => entry.detail)).not.toContain("restore-chain-ended-pass-resolve-turn-chain resolved");
    expect(restoredTurnWindow.state.log.map((entry) => entry.detail)).not.toContain("restore-chain-ended-pass-resolve-opponent-chain resolved");
    expect(getDuelLegalActions(restoredTurnWindow, 1)).toEqual([]);

    const restoredOpen = restoreDuel(serializeDuel(restoredTurnWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpen)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpen.state.chainPasses).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpen, 0)).toEqual(getGroupedDuelLegalActions(restoredTurnWindow, 0));
    expect(getGroupedDuelLegalActions(restoredOpen, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpen, 0));
  });

  it("restores turn-player priority after the opponent chains from a post-chainEnded handoff", () => {
    const session = createDuel({ seed: 248, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400", "600", "700"] },
      1: { main: ["500", "400"] },
    });
    startDuel(session);

    const starter = findHandCard(session, 0, "100");
    const cleanup = findHandCard(session, 0, "300");
    const openQuick = findHandCard(session, 0, "400");
    const turnFirst = findHandCard(session, 0, "600");
    const turnSecond = findHandCard(session, 0, "700");
    const opponentFirst = findHandCard(session, 1, "500");
    const opponentSecond = findHandCard(session, 1, "400");
    expect(starter).toBeDefined();
    expect(cleanup).toBeDefined();
    expect(openQuick).toBeDefined();
    expect(turnFirst).toBeDefined();
    expect(turnSecond).toBeDefined();
    expect(opponentFirst).toBeDefined();
    expect(opponentSecond).toBeDefined();
    moveDuelCard(session.state, turnFirst!.uid, "graveyard", 0);
    moveDuelCard(session.state, turnSecond!.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentFirst!.uid, "graveyard", 1);
    moveDuelCard(session.state, opponentSecond!.uid, "graveyard", 1);

    registerEffect(session, loggedEffect("restore-chain-ended-opponent-branch-starter", starter!.uid, 0, "ignition"));
    registerEffect(session, cleanupTrigger("restore-chain-ended-opponent-branch-cleanup", cleanup!.uid));
    registerEffect(session, openOnlyQuick("restore-chain-ended-opponent-branch-open", openQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-ended-opponent-branch-turn-first", turnFirst!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-ended-opponent-branch-turn-second", turnSecond!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-ended-opponent-branch-opponent-first", opponentFirst!.uid, 1, true));
    registerEffect(session, chainOnlyQuick("restore-chain-ended-opponent-branch-opponent-second", opponentSecond!.uid, 1, true));

    const starterAction = findEffectAction(session, 0, "restore-chain-ended-opponent-branch-starter");
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    const cleanupAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-chain-ended-opponent-branch-cleanup");
    expect(cleanupAction).toBeDefined();
    applyAndAssert(session, cleanupAction!);

    const openAction = findEffectAction(session, 0, "restore-chain-ended-opponent-branch-open");
    expect(openAction).toBeDefined();
    const opponentWindow = applyAndAssert(session, openAction!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-chain-ended-opponent-branch-opponent-first", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-chain-ended-opponent-branch-opponent-second", "chainResponse")).toBe(true);

    const opponentFirstAction = findEffectAction(session, 1, "restore-chain-ended-opponent-branch-opponent-first");
    expect(opponentFirstAction).toBeDefined();
    const turnWindow = applyAndAssert(session, opponentFirstAction!);
    expect(turnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(turnWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-chain-ended-opponent-branch-open",
      "restore-chain-ended-opponent-branch-opponent-first",
    ]);
    expect(session.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(session, 1)).toEqual([]);
    expect(hasGroupedEffect(turnWindow.legalActionGroups, 0, "restore-chain-ended-opponent-branch-turn-first", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(turnWindow.legalActionGroups, 0, "restore-chain-ended-opponent-branch-turn-second", "chainResponse")).toBe(true);

    const restoredTurnWindow = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restoredTurnWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-chain-ended-opponent-branch-open",
      "restore-chain-ended-opponent-branch-opponent-first",
    ]);
    expect(getDuelLegalActions(restoredTurnWindow, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredTurnWindow, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restoredTurnWindow, 0)).toEqual(getGroupedDuelLegalActions(session, 0));

    const staleOpponentFirst = applyResponse(restoredTurnWindow, opponentFirstAction!);
    expect(staleOpponentFirst.ok).toBe(false);
    expect(staleOpponentFirst.error).toContain("Response is not currently legal");
    expect(staleOpponentFirst.legalActions).toEqual(getDuelLegalActions(restoredTurnWindow, 0));
    expect(staleOpponentFirst.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTurnWindow, 0));

    const turnFirstAction = findEffectAction(restoredTurnWindow, 0, "restore-chain-ended-opponent-branch-turn-first");
    expect(turnFirstAction).toBeDefined();
    const opponentFollowupWindow = applyAndAssert(restoredTurnWindow, turnFirstAction!);
    expect(opponentFollowupWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(opponentFollowupWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-chain-ended-opponent-branch-open",
      "restore-chain-ended-opponent-branch-opponent-first",
      "restore-chain-ended-opponent-branch-turn-first",
    ]);
    expect(restoredTurnWindow.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restoredTurnWindow, 0)).toEqual([]);
    expect(hasGroupedEffect(opponentFollowupWindow.legalActionGroups, 1, "restore-chain-ended-opponent-branch-opponent-second", "chainResponse")).toBe(true);

    const restoredOpponentFollowup = restoreDuel(serializeDuel(restoredTurnWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentFollowup)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredOpponentFollowup, 1)).toEqual(getDuelLegalActions(restoredTurnWindow, 1));
    expect(getGroupedDuelLegalActions(restoredOpponentFollowup, 1)).toEqual(getGroupedDuelLegalActions(restoredTurnWindow, 1));
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function findEffectAction(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string) {
  return getDuelLegalActions(session, player).find((action) => action.type === "activateEffect" && action.effectId === effectId);
}

function findHandCard(session: ReturnType<typeof createDuel>, controller: 0 | 1, code: string) {
  return findPublicCard(session, controller, code, "hand");
}

function findPublicCard(session: ReturnType<typeof createDuel>, controller: 0 | 1, code: string, location: DuelLocation) {
  return queryPublicState(session).cards.find((card) => card.controller === controller && card.location === location && card.code === code);
}

function loggedEffect(id: string, sourceUid: string, controller: 0 | 1, event: "ignition" | "quick" | "trigger", triggerEvent?: DuelEffectDefinition["triggerEvent"]): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event,
    ...(triggerEvent === undefined ? {} : { triggerEvent }),
    range: ["hand"],
    operation(ctx) {
      ctx.log(`${id} resolved`);
    },
  };
}

function cleanupTrigger(id: string, sourceUid: string): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, 0, "trigger", "chainEnded"),
    optional: false,
    oncePerTurn: true,
    operation(ctx) {
      moveFirstCard(ctx.duel, 0, "600", "graveyard", "hand");
      moveFirstCard(ctx.duel, 0, "700", "graveyard", "hand");
      moveFirstCard(ctx.duel, 1, "500", "graveyard", "hand");
      moveFirstCard(ctx.duel, 1, "400", "graveyard", "hand");
      ctx.log(`${id} resolved`);
    },
  };
}

function openOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, "quick"),
    ...(oncePerTurn ? { oncePerTurn: true } : {}),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

function chainOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, "quick"),
    ...(oncePerTurn ? { oncePerTurn: true } : {}),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-chain-ended-handoff-starter": restoreLoggedEffect(),
    "restore-chain-ended-handoff-cleanup": restoreCleanupTrigger,
    "restore-chain-ended-handoff-open": restoreOpenOnlyQuick,
    "restore-chain-ended-handoff-extra-open": restoreOpenOnlyQuick,
    "restore-chain-ended-handoff-turn-chain": restoreChainOnlyQuick,
    "restore-chain-ended-handoff-opponent-chain": restoreChainOnlyQuick,
    "restore-chain-ended-pass-resolve-starter": restoreLoggedEffect(),
    "restore-chain-ended-pass-resolve-cleanup": restoreCleanupTrigger,
    "restore-chain-ended-pass-resolve-open": restoreOpenOnlyQuick,
    "restore-chain-ended-pass-resolve-turn-chain": restoreChainOnlyQuick,
    "restore-chain-ended-pass-resolve-opponent-chain": restoreChainOnlyQuick,
    "restore-chain-ended-opponent-branch-starter": restoreLoggedEffect(),
    "restore-chain-ended-opponent-branch-cleanup": restoreCleanupTrigger,
    "restore-chain-ended-opponent-branch-open": restoreOpenOnlyQuick,
    "restore-chain-ended-opponent-branch-turn-first": restoreChainOnlyQuick,
    "restore-chain-ended-opponent-branch-turn-second": restoreChainOnlyQuick,
    "restore-chain-ended-opponent-branch-opponent-first": restoreChainOnlyQuick,
    "restore-chain-ended-opponent-branch-opponent-second": restoreChainOnlyQuick,
  };
}

function restoreLoggedEffect(): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...effect,
    operation(ctx) {
      ctx.log(`${effect.id} resolved`);
    },
  });
}

function restoreCleanupTrigger(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...effect,
    operation(ctx) {
      moveFirstCard(ctx.duel, 0, "600", "graveyard", "hand");
      moveFirstCard(ctx.duel, 0, "700", "graveyard", "hand");
      moveFirstCard(ctx.duel, 1, "500", "graveyard", "hand");
      moveFirstCard(ctx.duel, 1, "400", "graveyard", "hand");
      ctx.log(`${effect.id} resolved`);
    },
  };
}

function restoreOpenOnlyQuick(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...restoreLoggedEffect()(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

function restoreChainOnlyQuick(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...restoreLoggedEffect()(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

function moveFirstCard(state: DuelState, controller: 0 | 1, code: string, from: DuelLocation, to: DuelLocation): void {
  const card = state.cards.find((candidate) => candidate.controller === controller && candidate.location === from && candidate.code === code);
  if (card) moveDuelCard(state, card.uid, to, controller);
}

function hasGroupedEffect(groups: ReturnType<typeof getGroupedDuelLegalActions>, player: 0 | 1, effectId: string, windowKind: "chainResponse" | "open"): boolean {
  return groups.some(
    (group) =>
      group.windowKind === windowKind &&
      group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowId === group.windowId && action.windowKind === windowKind),
  );
}

function hasGroupedPass(groups: ReturnType<typeof getGroupedDuelLegalActions>, player: 0 | 1): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "chainResponse" &&
      group.actions.some((action) => action.type === "passChain" && action.player === player && action.windowId === group.windowId && action.windowKind === "chainResponse"),
  );
}
