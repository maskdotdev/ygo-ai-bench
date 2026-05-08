import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("Main Phase 2 open fast pass-handoff restore", () => {
  it("restores phase-preserving fast-effect pass handoff windows", () => {
    const session = createDuel({ seed: 272, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const turnOpen = findPublicCard(session, 0, "hand", "100");
    const turnChain = findPublicCard(session, 0, "hand", "300");
    const opponentChain = findPublicCard(session, 1, "hand", "400");
    const opponentOpen = findPublicCard(session, 1, "hand", "500");
    expect(turnOpen).toBeDefined();
    expect(turnChain).toBeDefined();
    expect(opponentChain).toBeDefined();
    expect(opponentOpen).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-main2-pass-turn-open", turnOpen!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-main2-pass-turn-chain", turnChain!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-main2-pass-opponent-chain", opponentChain!.uid, 1));
    registerEffect(session, openOnlyQuick("restore-main2-pass-opponent-open", opponentOpen!.uid, 1));

    applyAndAssert(session, findPhaseAction(session, "battle")!);
    applyAndAssert(session, findPhaseAction(session, "main2")!);

    const restoredMain2 = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredMain2)).toMatchObject({ waitingFor: 0, windowKind: "open", phase: "main2", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(effectIds(restoredMain2, 0)).toEqual(["restore-main2-pass-turn-open"]);
    expect(getDuelLegalActions(restoredMain2, 1)).toEqual([]);
    expect(hasGroupedEffect(restoredMain2, 0, "restore-main2-pass-turn-open", "open")).toBe(true);
    expect(hasGroupedEffect(restoredMain2, 0, "restore-main2-pass-turn-chain", "open")).toBe(false);
    expect(hasGroupedEffect(restoredMain2, 1, "restore-main2-pass-opponent-open", "open")).toBe(false);

    const turnOpenAction = findEffectAction(restoredMain2, 0, "restore-main2-pass-turn-open");
    expect(turnOpenAction).toBeDefined();
    applyAndAssert(restoredMain2, turnOpenAction!);

    const restoredOpponentWindow = restoreDuel(serializeDuel(restoredMain2), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentWindow)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", phase: "main2" });
    expect(restoredOpponentWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-main2-pass-turn-open"]);
    expect(restoredOpponentWindow.state.chainPasses).toEqual([]);
    expect(effectIds(restoredOpponentWindow, 1)).toEqual(["restore-main2-pass-opponent-chain"]);
    expect(getDuelLegalActions(restoredOpponentWindow, 0)).toEqual([]);
    expect(hasGroupedEffect(restoredOpponentWindow, 1, "restore-main2-pass-opponent-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentWindow, 1, "restore-main2-pass-opponent-open", "chainResponse")).toBe(false);

    const opponentPass = getDuelLegalActions(restoredOpponentWindow, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    applyAndAssert(restoredOpponentWindow, opponentPass!);

    const restoredTurnHandoff = restoreDuel(serializeDuel(restoredOpponentWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnHandoff)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse", phase: "main2" });
    expect(restoredTurnHandoff.state.chain.map((link) => link.effectId)).toEqual(["restore-main2-pass-turn-open"]);
    expect(restoredTurnHandoff.state.chainPasses).toEqual([1]);
    expect(effectIds(restoredTurnHandoff, 0)).toEqual(["restore-main2-pass-turn-chain"]);
    expect(getDuelLegalActions(restoredTurnHandoff, 1)).toEqual([]);
    expect(hasGroupedEffect(restoredTurnHandoff, 0, "restore-main2-pass-turn-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredTurnHandoff, 0, "restore-main2-pass-turn-open", "chainResponse")).toBe(false);

    const turnPass = getDuelLegalActions(restoredTurnHandoff, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    applyAndAssert(restoredTurnHandoff, turnPass!);

    expect(queryPublicState(restoredTurnHandoff)).toMatchObject({ waitingFor: 0, windowKind: "open", phase: "main2", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredTurnHandoff.state.chainPasses).toEqual([]);
    expect(effectIds(restoredTurnHandoff, 0)).toEqual([]);
    expect(getDuelLegalActions(restoredTurnHandoff, 1)).toEqual([]);
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).toContain("restore-main2-pass-turn-open resolved");
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).not.toContain("restore-main2-pass-turn-chain resolved");
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).not.toContain("restore-main2-pass-opponent-chain resolved");
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
    "restore-main2-pass-turn-open": restoreOpenOnlyQuick(true),
    "restore-main2-pass-turn-chain": restoreChainOnlyQuick,
    "restore-main2-pass-opponent-chain": restoreChainOnlyQuick,
    "restore-main2-pass-opponent-open": restoreOpenOnlyQuick(),
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

function findPhaseAction(session: ReturnType<typeof createDuel>, phase: "battle" | "main2") {
  return getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === phase);
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
