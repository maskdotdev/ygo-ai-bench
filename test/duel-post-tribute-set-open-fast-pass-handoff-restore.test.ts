import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("post-Tribute-Set open fast pass-handoff restore", () => {
  it("restores post-tribute-set open fast pass-handoff windows", () => {
    const session = createDuel({ seed: 429, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["600", "100", "300", "700"] },
      1: { main: ["400", "500", "900", "900"] },
    });
    startDuel(session);

    const setMonster = findPublicCard(session, 0, "hand", "600");
    const tribute = findPublicCard(session, 0, "hand", "100");
    const turnOpen = findPublicCard(session, 0, "hand", "300");
    const turnChain = findPublicCard(session, 0, "hand", "700");
    const opponentChain = findPublicCard(session, 1, "hand", "400");
    const opponentOpen = findPublicCard(session, 1, "hand", "500");
    expect(setMonster).toBeDefined();
    expect(tribute).toBeDefined();
    expect(turnOpen).toBeDefined();
    expect(turnChain).toBeDefined();
    expect(opponentChain).toBeDefined();
    expect(opponentOpen).toBeDefined();

    const fieldTribute = moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);
    fieldTribute.position = "faceUpAttack";
    moveDuelCard(session.state, turnOpen!.uid, "graveyard", 0);
    moveDuelCard(session.state, turnChain!.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentChain!.uid, "graveyard", 1);
    moveDuelCard(session.state, opponentOpen!.uid, "graveyard", 1);

    registerEffect(session, openOnlyQuick("restore-post-tribute-set-turn-open", turnOpen!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-post-tribute-set-turn-chain", turnChain!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-post-tribute-set-opponent-chain", opponentChain!.uid, 1, true));
    registerEffect(session, openOnlyQuick("restore-post-tribute-set-opponent-open", opponentOpen!.uid, 1));

    const set = getDuelLegalActions(session, 0).find((action) => action.type === "tributeSet" && action.uid === setMonster!.uid && action.tributeUids.includes(tribute!.uid));
    expect(set?.type).toBe("tributeSet");
    if (!set || set.type !== "tributeSet") throw new Error("Expected Tribute Set action");
    applyAndAssert(session, set);

    const restoredPostSet = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredPostSet)).toMatchObject({ waitingFor: 0, windowKind: "open", phase: "main1", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredPostSet.state.players[0].normalSummonAvailable).toBe(false);
    expect(findPublicCard(restoredPostSet, 0, "monsterZone", "600")).toMatchObject({ uid: setMonster!.uid, faceUp: false, position: "faceDownDefense" });
    expect(findPublicCard(restoredPostSet, 0, "graveyard", "100")).toMatchObject({ uid: tribute!.uid });
    expect(cardsIn(restoredPostSet, 0, "graveyard")).toEqual(["300", "700", "100"]);
    expect(cardsIn(restoredPostSet, 1, "graveyard")).toEqual(["400", "500"]);
    expect(effectIds(restoredPostSet, 0)).toEqual(["restore-post-tribute-set-turn-open"]);
    expect(getDuelLegalActions(restoredPostSet, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredPostSet, 0).some((action) => (action.type === "tributeSummon" || action.type === "tributeSet") && action.uid === setMonster!.uid)).toBe(false);
    expect(hasGroupedEffect(restoredPostSet, 0, "restore-post-tribute-set-turn-open", "open")).toBe(true);
    expect(hasGroupedEffect(restoredPostSet, 0, "restore-post-tribute-set-turn-chain", "open")).toBe(false);
    expect(hasGroupedEffect(restoredPostSet, 1, "restore-post-tribute-set-opponent-open", "open")).toBe(false);

    const turnOpenAction = findEffectAction(restoredPostSet, 0, "restore-post-tribute-set-turn-open");
    expect(turnOpenAction).toBeDefined();
    applyAndAssert(restoredPostSet, turnOpenAction!);

    const restoredOpponentWindow = restoreDuel(serializeDuel(restoredPostSet), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentWindow)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", phase: "main1" });
    expect(restoredOpponentWindow.state.players[0].normalSummonAvailable).toBe(false);
    expect(restoredOpponentWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-post-tribute-set-turn-open"]);
    expect(restoredOpponentWindow.state.chainPasses).toEqual([]);
    expect(effectIds(restoredOpponentWindow, 1)).toEqual(["restore-post-tribute-set-opponent-chain"]);
    expect(getDuelLegalActions(restoredOpponentWindow, 0)).toEqual([]);
    expect(hasGroupedEffect(restoredOpponentWindow, 1, "restore-post-tribute-set-opponent-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentWindow, 1, "restore-post-tribute-set-opponent-open", "chainResponse")).toBe(false);

    const opponentPass = getDuelLegalActions(restoredOpponentWindow, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    applyAndAssert(restoredOpponentWindow, opponentPass!);

    const restoredTurnHandoff = restoreDuel(serializeDuel(restoredOpponentWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnHandoff)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse", phase: "main1" });
    expect(restoredTurnHandoff.state.players[0].normalSummonAvailable).toBe(false);
    expect(restoredTurnHandoff.state.chain.map((link) => link.effectId)).toEqual(["restore-post-tribute-set-turn-open"]);
    expect(restoredTurnHandoff.state.chainPasses).toEqual([1]);
    expect(effectIds(restoredTurnHandoff, 0)).toEqual(["restore-post-tribute-set-turn-chain"]);
    expect(getDuelLegalActions(restoredTurnHandoff, 1)).toEqual([]);
    expect(hasGroupedEffect(restoredTurnHandoff, 0, "restore-post-tribute-set-turn-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredTurnHandoff, 0, "restore-post-tribute-set-turn-open", "chainResponse")).toBe(false);
    expect(findPublicCard(restoredTurnHandoff, 0, "monsterZone", "600")).toMatchObject({ uid: setMonster!.uid, faceUp: false, position: "faceDownDefense" });
    expect(findPublicCard(restoredTurnHandoff, 0, "graveyard", "100")).toMatchObject({ uid: tribute!.uid });

    const turnPass = getDuelLegalActions(restoredTurnHandoff, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    applyAndAssert(restoredTurnHandoff, turnPass!);

    expect(queryPublicState(restoredTurnHandoff)).toMatchObject({ waitingFor: 0, windowKind: "open", phase: "main1", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredTurnHandoff.state.players[0].normalSummonAvailable).toBe(false);
    expect(restoredTurnHandoff.state.chainPasses).toEqual([]);
    expect(effectIds(restoredTurnHandoff, 0)).toEqual([]);
    expect(getDuelLegalActions(restoredTurnHandoff, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredTurnHandoff, 0).some((action) => (action.type === "tributeSummon" || action.type === "tributeSet") && action.uid === setMonster!.uid)).toBe(false);
    expect(findPublicCard(restoredTurnHandoff, 0, "monsterZone", "600")).toMatchObject({ uid: setMonster!.uid, faceUp: false, position: "faceDownDefense" });
    expect(findPublicCard(restoredTurnHandoff, 0, "graveyard", "100")).toMatchObject({ uid: tribute!.uid });
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).toContain("restore-post-tribute-set-turn-open resolved");
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).not.toContain("restore-post-tribute-set-turn-chain resolved");
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).not.toContain("restore-post-tribute-set-opponent-chain resolved");
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
    "restore-post-tribute-set-turn-open": restoreOpenOnlyQuick(true),
    "restore-post-tribute-set-turn-chain": restoreChainOnlyQuick(true),
    "restore-post-tribute-set-opponent-chain": restoreChainOnlyQuick(true),
    "restore-post-tribute-set-opponent-open": restoreOpenOnlyQuick(),
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
