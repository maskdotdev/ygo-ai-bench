import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData, DuelEffectDefinition, DuelSession } from "#duel/types.js";

describe("trigger shared count restore", () => {
  it("restores same-bucket shared-count optional triggers as decline-only after a sibling spends the count", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Shared Count Restore Summon", kind: "monster" },
      { code: "300", name: "Shared Count Restore First Trigger", kind: "monster" },
      { code: "400", name: "Shared Count Restore Second Trigger", kind: "monster" },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 501, startingHandSize: 3, cardReader: reader });
    loadDecks(session, { 0: { main: ["100", "300", "400"] }, 1: { main: ["100", "100", "100"] } });
    startDuel(session);

    const summoned = handCard(session, 0, "100");
    const firstSource = handCard(session, 0, "300");
    const secondSource = handCard(session, 0, "400");
    registerEffect(session, sharedCountTrigger("restore-shared-count-first", firstSource.uid, "Restored shared count first resolved"));
    registerEffect(session, sharedCountTrigger("restore-shared-count-second", secondSource.uid, "Restored shared count second should not resolve"));

    specialSummonDuelCard(session.state, summoned.uid);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-shared-count-first", "restore-shared-count-second"]);
    expect(queryPublicState(session).pendingTriggerBuckets).toEqual([
      { player: 0, triggerBucket: "turnOptional", triggerIds: session.state.pendingTriggers.map((trigger) => trigger.id) },
    ]);
    expect(queryPublicState(session).triggerOrderPrompt).toMatchObject({ player: 0, triggerBucket: "turnOptional" });

    const restoredBucket = restoreDuel(serializeDuel(session), reader, restoreRegistry());
    expect(queryPublicState(restoredBucket).triggerOrderPrompt).toMatchObject({ player: 0, triggerBucket: "turnOptional" });
    const firstActivation = getLegalActions(restoredBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-shared-count-first");
    const staleSecondActivation = getLegalActions(restoredBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-shared-count-second");
    expect(firstActivation).toBeDefined();
    expect(staleSecondActivation).toBeDefined();
    applyAndAssert(restoredBucket, firstActivation!);

    expect(restoredBucket.state.usedCountKeys).toEqual(["turn-1:0:code-1092"]);
    expect(restoredBucket.state.chain.map((link) => link.effectId)).toEqual(["restore-shared-count-first"]);
    expect(restoredBucket.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-shared-count-second"]);
    expect(queryPublicState(restoredBucket).triggerOrderPrompt).toBeUndefined();

    const restoredDeclineOnly = restoreDuel(serializeDuel(restoredBucket), reader, restoreRegistry());
    expect(restoredDeclineOnly.state.usedCountKeys).toEqual(["turn-1:0:code-1092"]);
    expect(restoredDeclineOnly.state.chain.map((link) => link.effectId)).toEqual(["restore-shared-count-first"]);
    expect(restoredDeclineOnly.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-shared-count-second"]);
    expect(getLegalActions(restoredDeclineOnly, 0).filter((action) => action.type === "activateTrigger")).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredDeclineOnly, 0).flatMap((group) => group.actions)).toEqual(getLegalActions(restoredDeclineOnly, 0));
    const staleResult = applyResponse(restoredDeclineOnly, staleSecondActivation!);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.legalActions).toEqual(getLegalActions(restoredDeclineOnly, 0));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredDeclineOnly, 0));

    const declineSecond = getLegalActions(restoredDeclineOnly, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-shared-count-second");
    expect(declineSecond).toBeDefined();
    const declined = applyAndAssert(restoredDeclineOnly, declineSecond!);
    expect(declined.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredDeclineOnly.state.log.some((entry) => entry.detail === "Restored shared count first resolved")).toBe(true);
    expect(restoredDeclineOnly.state.log.some((entry) => entry.detail === "Restored shared count second should not resolve")).toBe(false);
  });
});

function handCard(session: DuelSession, player: 0 | 1, code: string) {
  const card = session.state.cards.find((candidate) => candidate.controller === player && candidate.location === "hand" && candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function sharedCountTrigger(id: string, sourceUid: string, detail: string): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller: 0,
    event: "trigger",
    triggerEvent: "specialSummoned",
    countLimit: 1,
    countLimitCode: 0x444,
    range: ["hand"],
    operation(ctx) {
      ctx.log(detail);
    },
  };
}

function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-shared-count-first": restoreLoggedEffect("Restored shared count first resolved"),
    "restore-shared-count-second": restoreLoggedEffect("Restored shared count second should not resolve"),
  };
}

function restoreLoggedEffect(detail: string) {
  return (effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition => ({
    ...effect,
    operation(ctx) {
      ctx.log(detail);
    },
  });
}

function applyAndAssert(session: DuelSession, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
