import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("end-turn open fast pass-handoff restore", () => {
  it("restores new-turn fast-effect pass handoff windows", () => {
    const session = createDuel({ seed: 268, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["400", "300"] },
    });
    startDuel(session);

    const previousOpen = findPublicCard(session, 0, "hand", "100");
    const previousChain = findPublicCard(session, 0, "hand", "500");
    const nextOpen = findPublicCard(session, 1, "hand", "400");
    const nextChain = findPublicCard(session, 1, "hand", "300");
    expect(previousOpen).toBeDefined();
    expect(previousChain).toBeDefined();
    expect(nextOpen).toBeDefined();
    expect(nextChain).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-end-turn-pass-previous-open", previousOpen!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-end-turn-pass-previous-chain", previousChain!.uid, 0));
    registerEffect(session, openOnlyQuick("restore-end-turn-pass-next-open", nextOpen!.uid, 1, true));
    registerEffect(session, chainOnlyQuick("restore-end-turn-pass-next-chain", nextChain!.uid, 1));

    const restoredStart = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    const endTurn = getDuelLegalActions(restoredStart, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeDefined();
    applyAndAssert(restoredStart, endTurn!);

    const restoredNewTurn = restoreDuel(serializeDuel(restoredStart), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredNewTurn)).toMatchObject({ waitingFor: 1, windowKind: "open", turnPlayer: 1, turn: 2, phase: "main1", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(effectIds(restoredNewTurn, 1)).toEqual(["restore-end-turn-pass-next-open"]);
    expect(getDuelLegalActions(restoredNewTurn, 0)).toEqual([]);
    expect(hasGroupedEffect(restoredNewTurn, 1, "restore-end-turn-pass-next-open", "open")).toBe(true);
    expect(hasGroupedEffect(restoredNewTurn, 1, "restore-end-turn-pass-next-chain", "open")).toBe(false);
    expect(hasGroupedEffect(restoredNewTurn, 0, "restore-end-turn-pass-previous-open", "open")).toBe(false);

    const nextOpenAction = findEffectAction(restoredNewTurn, 1, "restore-end-turn-pass-next-open");
    expect(nextOpenAction).toBeDefined();
    applyAndAssert(restoredNewTurn, nextOpenAction!);

    const restoredPreviousResponse = restoreDuel(serializeDuel(restoredNewTurn), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredPreviousResponse)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse", turnPlayer: 1, turn: 2, phase: "main1" });
    expect(restoredPreviousResponse.state.chain.map((link) => link.effectId)).toEqual(["restore-end-turn-pass-next-open"]);
    expect(restoredPreviousResponse.state.chainPasses).toEqual([]);
    expect(effectIds(restoredPreviousResponse, 0)).toEqual(["restore-end-turn-pass-previous-chain"]);
    expect(getDuelLegalActions(restoredPreviousResponse, 1)).toEqual([]);
    expect(hasGroupedEffect(restoredPreviousResponse, 0, "restore-end-turn-pass-previous-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredPreviousResponse, 0, "restore-end-turn-pass-previous-open", "chainResponse")).toBe(false);

    const previousPass = getDuelLegalActions(restoredPreviousResponse, 0).find((action) => action.type === "passChain");
    expect(previousPass).toBeDefined();
    applyAndAssert(restoredPreviousResponse, previousPass!);

    const restoredNextHandoff = restoreDuel(serializeDuel(restoredPreviousResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredNextHandoff)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", turnPlayer: 1, turn: 2, phase: "main1" });
    expect(restoredNextHandoff.state.chain.map((link) => link.effectId)).toEqual(["restore-end-turn-pass-next-open"]);
    expect(restoredNextHandoff.state.chainPasses).toEqual([0]);
    expect(effectIds(restoredNextHandoff, 1)).toEqual(["restore-end-turn-pass-next-chain"]);
    expect(getDuelLegalActions(restoredNextHandoff, 0)).toEqual([]);
    expect(hasGroupedEffect(restoredNextHandoff, 1, "restore-end-turn-pass-next-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredNextHandoff, 1, "restore-end-turn-pass-next-open", "chainResponse")).toBe(false);

    const nextPass = getDuelLegalActions(restoredNextHandoff, 1).find((action) => action.type === "passChain");
    expect(nextPass).toBeDefined();
    applyAndAssert(restoredNextHandoff, nextPass!);

    expect(queryPublicState(restoredNextHandoff)).toMatchObject({ waitingFor: 1, windowKind: "open", turnPlayer: 1, turn: 2, phase: "main1", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredNextHandoff.state.chainPasses).toEqual([]);
    expect(effectIds(restoredNextHandoff, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredNextHandoff, 0)).toEqual([]);
    expect(restoredNextHandoff.state.log.map((entry) => entry.detail)).toContain("restore-end-turn-pass-next-open resolved");
    expect(restoredNextHandoff.state.log.map((entry) => entry.detail)).not.toContain("restore-end-turn-pass-next-chain resolved");
    expect(restoredNextHandoff.state.log.map((entry) => entry.detail)).not.toContain("restore-end-turn-pass-previous-chain resolved");
  });
});

function openOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return quickEffect(id, sourceUid, controller, 0, oncePerTurn);
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
    "restore-end-turn-pass-previous-open": restoreOpenOnlyQuick(),
    "restore-end-turn-pass-previous-chain": restoreChainOnlyQuick,
    "restore-end-turn-pass-next-open": restoreOpenOnlyQuick(true),
    "restore-end-turn-pass-next-chain": restoreChainOnlyQuick,
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

function restoreOpenOnlyQuick(oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreLoggedEffect({ ...effect, ...(oncePerTurn ? { oncePerTurn: true } : {}) }),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  });
}

function restoreChainOnlyQuick(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...restoreLoggedEffect(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
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

function hasGroupedEffect(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string, windowKind: "chainResponse" | "open"): boolean {
  return getGroupedDuelLegalActions(session, player).some((group) =>
    group.windowKind === windowKind && group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowKind === windowKind),
  );
}
