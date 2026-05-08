import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("chainSolved before chainEnded trigger bucket restore", () => {
  it("keeps chainEnded buckets deferred after a restored chain resolves until chainSolved buckets finish", () => {
    const session = createDuel({ seed: 466, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400", "500"] },
      1: { main: ["400", "400", "400", "400"] },
    });
    startDuel(session);

    const starter = findPublicCard(session, 0, "hand", "100");
    const chainSolvedSource = findPublicCard(session, 0, "hand", "300");
    const chainEndedSource = findPublicCard(session, 0, "hand", "400");
    const openQuickSource = findPublicCard(session, 0, "hand", "500");
    const opponentChainSource = findPublicCard(session, 1, "hand", "400");
    expect(starter).toBeDefined();
    expect(chainSolvedSource).toBeDefined();
    expect(chainEndedSource).toBeDefined();
    expect(openQuickSource).toBeDefined();
    expect(opponentChainSource).toBeDefined();

    registerEffect(session, { ...loggedEffect("restore-solved-ended-starter", starter!.uid, "ignition", "restore-solved-ended-starter resolved"), oncePerTurn: true });
    registerEffect(session, {
      ...loggedEffect("restore-solved-ended-chain-solved", chainSolvedSource!.uid, "trigger", "restore-solved-ended-chain-solved resolved", "chainSolved"),
      oncePerTurn: true,
      optional: false,
    });
    registerEffect(session, {
      ...loggedEffect("restore-solved-ended-chain-ended", chainEndedSource!.uid, "trigger", "restore-solved-ended-chain-ended resolved", "chainEnded"),
      oncePerTurn: true,
      optional: false,
    });
    registerEffect(session, openOnlyQuick("restore-solved-ended-open-quick", openQuickSource!.uid));
    registerEffect(session, chainOnlyQuick("restore-solved-ended-opponent-chain-quick", opponentChainSource!.uid, 1));

    const starterAction = findEffectAction(session, 0, "restore-solved-ended-starter");
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);

    const restoredInitialChain = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredInitialChain)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredInitialChain.state.chain.map((link) => link.effectId)).toEqual(["restore-solved-ended-starter"]);
    expect(effectIds(restoredInitialChain, 1)).toEqual(["restore-solved-ended-opponent-chain-quick"]);
    const initialPass = getDuelLegalActions(restoredInitialChain, 1).find((action) => action.type === "passChain");
    expect(initialPass).toBeDefined();
    applyAndAssert(restoredInitialChain, initialPass!);

    const restoredChainSolvedBucket = restoreDuel(serializeDuel(restoredInitialChain), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainSolvedBucket)).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", chain: [], pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }] });
    expect(restoredChainSolvedBucket.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-solved-ended-chain-solved", eventName: "chainSolved", triggerBucket: "turnMandatory" }),
    ]);
    expect(restoredChainSolvedBucket.state.pendingTriggers.some((trigger) => trigger.effectId === "restore-solved-ended-chain-ended")).toBe(false);
    expect(getDuelLegalActions(restoredChainSolvedBucket, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredChainSolvedBucket, 0).some((action) => action.type === "declineTrigger")).toBe(false);
    expect(hasGroupedTrigger(restoredChainSolvedBucket, 0, "restore-solved-ended-chain-solved", "triggerBucket")).toBe(true);
    expect(hasGroupedEffect(restoredChainSolvedBucket, 0, "restore-solved-ended-open-quick", "triggerBucket")).toBe(false);

    const chainSolvedTrigger = getDuelLegalActions(restoredChainSolvedBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-solved-ended-chain-solved");
    expect(chainSolvedTrigger).toBeDefined();
    applyAndAssert(restoredChainSolvedBucket, chainSolvedTrigger!);

    const restoredChainSolvedResponse = restoreDuel(serializeDuel(restoredChainSolvedBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainSolvedResponse)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredChainSolvedResponse.state.chain.map((link) => link.effectId)).toEqual(["restore-solved-ended-chain-solved"]);
    expect(restoredChainSolvedResponse.state.pendingTriggers.some((trigger) => trigger.effectId === "restore-solved-ended-chain-ended")).toBe(false);
    expect(effectIds(restoredChainSolvedResponse, 1)).toEqual(["restore-solved-ended-opponent-chain-quick"]);
    const chainSolvedPass = getDuelLegalActions(restoredChainSolvedResponse, 1).find((action) => action.type === "passChain");
    expect(chainSolvedPass).toBeDefined();
    applyAndAssert(restoredChainSolvedResponse, chainSolvedPass!);

    const restoredChainEndedBucket = restoreDuel(serializeDuel(restoredChainSolvedResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainEndedBucket)).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", chain: [], pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }] });
    expect(restoredChainEndedBucket.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-solved-ended-chain-ended", eventName: "chainEnded", triggerBucket: "turnMandatory" }),
    ]);
    expect(restoredChainEndedBucket.state.pendingTriggers.some((trigger) => trigger.effectId === "restore-solved-ended-chain-solved")).toBe(false);
    expect(restoredChainEndedBucket.state.log.map((entry) => entry.detail)).toContain("restore-solved-ended-chain-solved resolved");
    expect(restoredChainEndedBucket.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-ended-chain-ended resolved");
    expect(getDuelLegalActions(restoredChainEndedBucket, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredChainEndedBucket, 0).some((action) => action.type === "declineTrigger")).toBe(false);
    expect(hasGroupedTrigger(restoredChainEndedBucket, 0, "restore-solved-ended-chain-ended", "triggerBucket")).toBe(true);
    expect(hasGroupedEffect(restoredChainEndedBucket, 0, "restore-solved-ended-open-quick", "triggerBucket")).toBe(false);

    const chainEndedTrigger = getDuelLegalActions(restoredChainEndedBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-solved-ended-chain-ended");
    expect(chainEndedTrigger).toBeDefined();
    applyAndAssert(restoredChainEndedBucket, chainEndedTrigger!);

    const restoredChainEndedResponse = restoreDuel(serializeDuel(restoredChainEndedBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainEndedResponse)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredChainEndedResponse.state.chain.map((link) => link.effectId)).toEqual(["restore-solved-ended-chain-ended"]);
    expect(effectIds(restoredChainEndedResponse, 1)).toEqual(["restore-solved-ended-opponent-chain-quick"]);
    expect(restoredChainEndedResponse.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-ended-chain-ended resolved");
    const chainEndedPass = getDuelLegalActions(restoredChainEndedResponse, 1).find((action) => action.type === "passChain");
    expect(chainEndedPass).toBeDefined();
    applyAndAssert(restoredChainEndedResponse, chainEndedPass!);

    const restoredOpen = restoreDuel(serializeDuel(restoredChainEndedResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpen)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpen.state.chainPasses).toEqual([]);
    expect(restoredOpen.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-solved-ended-starter resolved",
      "restore-solved-ended-chain-solved resolved",
      "restore-solved-ended-chain-ended resolved",
    ]));
    expect(restoredOpen.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-ended-opponent-chain-quick resolved");
    expect(effectIds(restoredOpen, 0)).toEqual(["restore-solved-ended-open-quick"]);
    expect(getGroupedDuelLegalActions(restoredOpen, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpen, 0));
    expect(getDuelLegalActions(restoredOpen, 1)).toEqual([]);

    const staleChainSolved = applyResponse(restoredChainSolvedBucket, chainSolvedTrigger!);
    expect(staleChainSolved.ok).toBe(false);
    expect(staleChainSolved.error).toContain("Response is not currently legal");
    expect(staleChainSolved.legalActions).toEqual(getDuelLegalActions(restoredChainSolvedBucket, 1));
    expect(staleChainSolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredChainSolvedBucket, 1));
  });
});

function loggedEffect(id: string, sourceUid: string, event: "ignition" | "trigger", detail: string, triggerEvent?: DuelEffectDefinition["triggerEvent"]): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller: 0,
    event,
    ...(triggerEvent === undefined ? {} : { triggerEvent }),
    range: ["hand"],
    operation(ctx) {
      ctx.log(detail);
    },
  };
}

function openOnlyQuick(id: string, sourceUid: string): DuelEffectDefinition {
  return quickEffect(id, sourceUid, 0, 0);
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
    "restore-solved-ended-starter": restoreLoggedEffect,
    "restore-solved-ended-chain-solved": restoreLoggedEffect,
    "restore-solved-ended-chain-ended": restoreLoggedEffect,
    "restore-solved-ended-open-quick": restoreOpenOnlyQuick,
    "restore-solved-ended-opponent-chain-quick": restoreChainOnlyQuick,
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

function restoreChainOnlyQuick(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...restoreLoggedEffect(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
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

function findEffectAction(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string) {
  return getDuelLegalActions(session, player).find((action) => action.type === "activateEffect" && action.effectId === effectId);
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

function hasGroupedTrigger(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string, windowKind: "triggerBucket"): boolean {
  return getGroupedDuelLegalActions(session, player).some((group) =>
    group.windowKind === windowKind && group.actions.some((action) => action.type === "activateTrigger" && action.player === player && action.effectId === effectId && action.windowKind === windowKind),
  );
}

function hasGroupedEffect(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string, windowKind: "triggerBucket" | "open"): boolean {
  return getGroupedDuelLegalActions(session, player).some((group) =>
    group.windowKind === windowKind && group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowKind === windowKind),
  );
}
