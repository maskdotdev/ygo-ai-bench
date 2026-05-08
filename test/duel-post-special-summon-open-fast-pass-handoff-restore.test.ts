import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("post-Special-Summon open fast pass-handoff restore", () => {
  it("restores post-special-summon open fast pass-handoff windows", () => {
    const session = createDuel({ seed: 431, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "600"] },
      1: { main: ["400", "500", "900"] },
    });
    startDuel(session);

    const summoned = findPublicCard(session, 0, "hand", "100");
    const turnOpen = findPublicCard(session, 0, "hand", "300");
    const turnChain = findPublicCard(session, 0, "hand", "600");
    const opponentChain = findPublicCard(session, 1, "hand", "400");
    const opponentOpen = findPublicCard(session, 1, "hand", "500");
    expect(summoned).toBeDefined();
    expect(turnOpen).toBeDefined();
    expect(turnChain).toBeDefined();
    expect(opponentChain).toBeDefined();
    expect(opponentOpen).toBeDefined();

    moveDuelCard(session.state, turnOpen!.uid, "graveyard", 0);
    moveDuelCard(session.state, turnChain!.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentChain!.uid, "graveyard", 1);
    moveDuelCard(session.state, opponentOpen!.uid, "graveyard", 1);

    registerEffect(session, summonProcedure("restore-post-special-procedure", summoned!.uid, 0));
    registerEffect(session, openOnlyQuick("restore-post-special-turn-open", turnOpen!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-post-special-turn-chain", turnChain!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-post-special-opponent-chain", opponentChain!.uid, 1, true));
    registerEffect(session, openOnlyQuick("restore-post-special-opponent-open", opponentOpen!.uid, 1));

    const procedure = getDuelLegalActions(session, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === summoned!.uid && action.effectId === "restore-post-special-procedure");
    expect(procedure).toBeDefined();
    applyAndAssert(session, procedure!);

    const restoredPostSummon = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredPostSummon)).toMatchObject({ waitingFor: 0, windowKind: "open", phase: "main1", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(findPublicCard(restoredPostSummon, 0, "monsterZone", "100")).toMatchObject({ uid: summoned!.uid, faceUp: true, position: "faceUpAttack" });
    expect(cardsIn(restoredPostSummon, 0, "graveyard")).toEqual(["300", "600"]);
    expect(cardsIn(restoredPostSummon, 1, "graveyard")).toEqual(["400", "500"]);
    expect(effectIds(restoredPostSummon, 0)).toEqual(["restore-post-special-turn-open"]);
    expect(getDuelLegalActions(restoredPostSummon, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredPostSummon, 0).some((action) => action.type === "specialSummonProcedure" && action.effectId === "restore-post-special-procedure")).toBe(false);
    expect(hasGroupedEffect(restoredPostSummon, 0, "restore-post-special-turn-open", "open")).toBe(true);
    expect(hasGroupedEffect(restoredPostSummon, 0, "restore-post-special-turn-chain", "open")).toBe(false);
    expect(hasGroupedEffect(restoredPostSummon, 1, "restore-post-special-opponent-open", "open")).toBe(false);

    const turnOpenAction = findEffectAction(restoredPostSummon, 0, "restore-post-special-turn-open");
    expect(turnOpenAction).toBeDefined();
    applyAndAssert(restoredPostSummon, turnOpenAction!);

    const restoredOpponentWindow = restoreDuel(serializeDuel(restoredPostSummon), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentWindow)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", phase: "main1" });
    expect(restoredOpponentWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-post-special-turn-open"]);
    expect(restoredOpponentWindow.state.chainPasses).toEqual([]);
    expect(effectIds(restoredOpponentWindow, 1)).toEqual(["restore-post-special-opponent-chain"]);
    expect(getDuelLegalActions(restoredOpponentWindow, 0)).toEqual([]);
    expect(hasGroupedEffect(restoredOpponentWindow, 1, "restore-post-special-opponent-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentWindow, 1, "restore-post-special-opponent-open", "chainResponse")).toBe(false);

    const opponentPass = getDuelLegalActions(restoredOpponentWindow, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    applyAndAssert(restoredOpponentWindow, opponentPass!);

    const restoredTurnHandoff = restoreDuel(serializeDuel(restoredOpponentWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnHandoff)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse", phase: "main1" });
    expect(restoredTurnHandoff.state.chain.map((link) => link.effectId)).toEqual(["restore-post-special-turn-open"]);
    expect(restoredTurnHandoff.state.chainPasses).toEqual([1]);
    expect(effectIds(restoredTurnHandoff, 0)).toEqual(["restore-post-special-turn-chain"]);
    expect(getDuelLegalActions(restoredTurnHandoff, 1)).toEqual([]);
    expect(hasGroupedEffect(restoredTurnHandoff, 0, "restore-post-special-turn-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredTurnHandoff, 0, "restore-post-special-turn-open", "chainResponse")).toBe(false);
    expect(findPublicCard(restoredTurnHandoff, 0, "monsterZone", "100")).toMatchObject({ uid: summoned!.uid, faceUp: true, position: "faceUpAttack" });

    const turnPass = getDuelLegalActions(restoredTurnHandoff, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    applyAndAssert(restoredTurnHandoff, turnPass!);

    expect(queryPublicState(restoredTurnHandoff)).toMatchObject({ waitingFor: 0, windowKind: "open", phase: "main1", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredTurnHandoff.state.chainPasses).toEqual([]);
    expect(effectIds(restoredTurnHandoff, 0)).toEqual([]);
    expect(getDuelLegalActions(restoredTurnHandoff, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredTurnHandoff, 0).some((action) => action.type === "specialSummonProcedure" && action.effectId === "restore-post-special-procedure")).toBe(false);
    expect(findPublicCard(restoredTurnHandoff, 0, "monsterZone", "100")).toMatchObject({ uid: summoned!.uid, faceUp: true, position: "faceUpAttack" });
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).toContain("restore-post-special-procedure procedure applied");
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).toContain("restore-post-special-turn-open resolved");
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).not.toContain("restore-post-special-turn-chain resolved");
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).not.toContain("restore-post-special-opponent-chain resolved");
  });
});

function summonProcedure(id: string, sourceUid: string, controller: 0 | 1): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "summonProcedure",
    range: ["hand"],
    operation(ctx) {
      ctx.log(`${id} procedure applied`);
    },
  };
}

function restoreSummonProcedure(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...effect,
    operation(ctx) {
      ctx.log(`${effect.id} procedure applied`);
    },
  };
}

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
    range: ["graveyard"],
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
    "restore-post-special-procedure": restoreSummonProcedure,
    "restore-post-special-turn-open": restoreOpenOnlyQuick(true),
    "restore-post-special-turn-chain": restoreChainOnlyQuick(true),
    "restore-post-special-opponent-chain": restoreChainOnlyQuick(true),
    "restore-post-special-opponent-open": restoreOpenOnlyQuick(),
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

function restoreChainOnlyQuick(oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreLoggedEffect({ ...effect, ...(oncePerTurn ? { oncePerTurn: true } : {}) }),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  });
}

function findEffectAction(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string) {
  return getDuelLegalActions(session, player).find((action) => action.type === "activateEffect" && action.effectId === effectId);
}

function effectIds(session: ReturnType<typeof createDuel>, player: 0 | 1): string[] {
  return getDuelLegalActions(session, player)
    .filter((action) => action.type === "activateEffect")
    .map((action) => action.effectId);
}

function cardsIn(session: ReturnType<typeof createDuel>, controller: 0 | 1, location: "graveyard" | "monsterZone"): string[] {
  return queryPublicState(session).cards
    .filter((card) => card.controller === controller && card.location === location)
    .map((card) => card.code);
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
