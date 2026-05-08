import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData, DuelEffectDefinition } from "#duel/types.js";

const pendulumCards: DuelCardData[] = [
  { code: "100", name: "Post Pendulum Restore Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
  { code: "200", name: "Post Pendulum Restore High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
  { code: "300", name: "Post Pendulum Restore Candidate", kind: "monster", typeFlags: 0x1000001, level: 4 },
  { code: "400", name: "Post Pendulum Restore Turn Open Quick", kind: "monster", level: 4 },
  { code: "700", name: "Post Pendulum Restore Turn Chain Quick", kind: "monster", level: 4 },
  { code: "500", name: "Post Pendulum Restore Opponent Chain Quick", kind: "monster", level: 4 },
  { code: "600", name: "Post Pendulum Restore Opponent Open Quick", kind: "monster", level: 4 },
];

describe("post-Pendulum-Summon open fast pass-handoff restore", () => {
  it("restores post-pendulum-summon open fast pass-handoff windows", () => {
    const session = createDuel({ seed: 466, startingHandSize: 5, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "700"] },
      1: { main: ["500", "600"] },
    });
    startDuel(session);

    const low = cardIn(session, 0, "hand", "100");
    const high = cardIn(session, 0, "hand", "200");
    const candidate = cardIn(session, 0, "hand", "300");
    const turnOpen = cardIn(session, 0, "hand", "400");
    const turnChain = cardIn(session, 0, "hand", "700");
    const opponentChain = cardIn(session, 1, "hand", "500");
    const opponentOpen = cardIn(session, 1, "hand", "600");
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(candidate).toBeDefined();
    expect(turnOpen).toBeDefined();
    expect(turnChain).toBeDefined();
    expect(opponentChain).toBeDefined();
    expect(opponentOpen).toBeDefined();

    moveDuelCard(session.state, low!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, high!.uid, "spellTrapZone", 0).sequence = 1;
    moveDuelCard(session.state, turnOpen!.uid, "graveyard", 0);
    moveDuelCard(session.state, turnChain!.uid, "graveyard", 0);
    moveDuelCard(session.state, opponentChain!.uid, "graveyard", 1);
    moveDuelCard(session.state, opponentOpen!.uid, "graveyard", 1);

    registerEffect(session, openOnlyQuick("restore-post-pendulum-turn-open", turnOpen!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-post-pendulum-turn-chain", turnChain!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-post-pendulum-opponent-chain", opponentChain!.uid, 1, true));
    registerEffect(session, openOnlyQuick("restore-post-pendulum-opponent-open", opponentOpen!.uid, 1));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "pendulumSummon" && action.summonUids.includes(candidate!.uid));
    expect(summon?.type).toBe("pendulumSummon");
    if (!summon || summon.type !== "pendulumSummon") throw new Error("Expected Pendulum Summon action");
    applyAndAssert(session, { ...summon, summonUids: [candidate!.uid] });

    const restoredPostSummon = restoreDuel(serializeDuel(session), createCardReader(pendulumCards), restoreRegistry());
    expect(queryPublicState(restoredPostSummon)).toMatchObject({ waitingFor: 0, windowKind: "open", phase: "main1", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredPostSummon.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(cardIn(restoredPostSummon, 0, "monsterZone", "300")).toMatchObject({ uid: candidate!.uid, faceUp: true, position: "faceUpAttack" });
    expect(cardsIn(restoredPostSummon, 0, "spellTrapZone")).toEqual(["100", "200"]);
    expect(cardsIn(restoredPostSummon, 0, "graveyard")).toEqual(["400", "700"]);
    expect(cardsIn(restoredPostSummon, 1, "graveyard")).toEqual(["500", "600"]);
    expect(effectIds(restoredPostSummon, 0)).toEqual(["restore-post-pendulum-turn-open"]);
    expect(getDuelLegalActions(restoredPostSummon, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredPostSummon, 0).some((action) => action.type === "pendulumSummon" && action.summonUids.includes(candidate!.uid))).toBe(false);
    expect(hasGroupedEffect(restoredPostSummon, 0, "restore-post-pendulum-turn-open", "open")).toBe(true);
    expect(hasGroupedEffect(restoredPostSummon, 0, "restore-post-pendulum-turn-chain", "open")).toBe(false);
    expect(hasGroupedEffect(restoredPostSummon, 1, "restore-post-pendulum-opponent-open", "open")).toBe(false);

    const turnOpenAction = findEffectAction(restoredPostSummon, 0, "restore-post-pendulum-turn-open");
    expect(turnOpenAction).toBeDefined();
    applyAndAssert(restoredPostSummon, turnOpenAction!);

    const restoredOpponentWindow = restoreDuel(serializeDuel(restoredPostSummon), createCardReader(pendulumCards), restoreRegistry());
    expect(queryPublicState(restoredOpponentWindow)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", phase: "main1" });
    expect(restoredOpponentWindow.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(restoredOpponentWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-post-pendulum-turn-open"]);
    expect(restoredOpponentWindow.state.chainPasses).toEqual([]);
    expect(effectIds(restoredOpponentWindow, 1)).toEqual(["restore-post-pendulum-opponent-chain"]);
    expect(getDuelLegalActions(restoredOpponentWindow, 0)).toEqual([]);
    expect(hasGroupedEffect(restoredOpponentWindow, 1, "restore-post-pendulum-opponent-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentWindow, 1, "restore-post-pendulum-opponent-open", "chainResponse")).toBe(false);

    const opponentPass = getDuelLegalActions(restoredOpponentWindow, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    applyAndAssert(restoredOpponentWindow, opponentPass!);

    const restoredTurnHandoff = restoreDuel(serializeDuel(restoredOpponentWindow), createCardReader(pendulumCards), restoreRegistry());
    expect(queryPublicState(restoredTurnHandoff)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse", phase: "main1" });
    expect(restoredTurnHandoff.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(restoredTurnHandoff.state.chain.map((link) => link.effectId)).toEqual(["restore-post-pendulum-turn-open"]);
    expect(restoredTurnHandoff.state.chainPasses).toEqual([1]);
    expect(effectIds(restoredTurnHandoff, 0)).toEqual(["restore-post-pendulum-turn-chain"]);
    expect(getDuelLegalActions(restoredTurnHandoff, 1)).toEqual([]);
    expect(hasGroupedEffect(restoredTurnHandoff, 0, "restore-post-pendulum-turn-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredTurnHandoff, 0, "restore-post-pendulum-turn-open", "chainResponse")).toBe(false);
    expect(cardIn(restoredTurnHandoff, 0, "monsterZone", "300")).toMatchObject({ uid: candidate!.uid, faceUp: true, position: "faceUpAttack" });

    const turnPass = getDuelLegalActions(restoredTurnHandoff, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    applyAndAssert(restoredTurnHandoff, turnPass!);

    expect(queryPublicState(restoredTurnHandoff)).toMatchObject({ waitingFor: 0, windowKind: "open", phase: "main1", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredTurnHandoff.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(restoredTurnHandoff.state.chainPasses).toEqual([]);
    expect(effectIds(restoredTurnHandoff, 0)).toEqual([]);
    expect(getDuelLegalActions(restoredTurnHandoff, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredTurnHandoff, 0).some((action) => action.type === "pendulumSummon" && action.summonUids.includes(candidate!.uid))).toBe(false);
    expect(cardIn(restoredTurnHandoff, 0, "monsterZone", "300")).toMatchObject({ uid: candidate!.uid, faceUp: true, position: "faceUpAttack" });
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).toContain("restore-post-pendulum-turn-open resolved");
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).not.toContain("restore-post-pendulum-turn-chain resolved");
    expect(restoredTurnHandoff.state.log.map((entry) => entry.detail)).not.toContain("restore-post-pendulum-opponent-chain resolved");
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
    "restore-post-pendulum-turn-open": restoreOpenOnlyQuick(true),
    "restore-post-pendulum-turn-chain": restoreChainOnlyQuick(true),
    "restore-post-pendulum-opponent-chain": restoreChainOnlyQuick(true),
    "restore-post-pendulum-opponent-open": restoreOpenOnlyQuick(),
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

function cardIn(session: ReturnType<typeof createDuel>, controller: 0 | 1, location: "hand" | "graveyard" | "monsterZone" | "spellTrapZone", code: string) {
  return queryPublicState(session).cards.find((card) => card.controller === controller && card.location === location && card.code === code);
}

function cardsIn(session: ReturnType<typeof createDuel>, controller: 0 | 1, location: "graveyard" | "monsterZone" | "spellTrapZone"): string[] {
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
