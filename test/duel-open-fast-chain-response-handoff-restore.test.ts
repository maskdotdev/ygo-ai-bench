import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("open fast chain-response handoff restore", () => {
  it("restores the opponent response window after the turn player passes an opponent chain link", () => {
    const session = createDuel({ seed: 256, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "700"] },
      1: { main: ["300", "500", "600"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    const turnChainQuick = findHandCard(session, 0, "200");
    const opponentFirst = findHandCard(session, 1, "300");
    const opponentSecond = findHandCard(session, 1, "500");
    const opponentOpenOnly = findHandCard(session, 1, "600");
    expect(turnOpenQuick).toBeDefined();
    expect(turnChainQuick).toBeDefined();
    expect(opponentFirst).toBeDefined();
    expect(opponentSecond).toBeDefined();
    expect(opponentOpenOnly).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-chain-handoff-turn-open-quick", turnOpenQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-handoff-turn-chain-quick", turnChainQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-handoff-opponent-first-chain-quick", opponentFirst!.uid, 1, true));
    registerEffect(session, chainOnlyQuick("restore-chain-handoff-opponent-second-chain-quick", opponentSecond!.uid, 1, true));
    registerEffect(session, openOnlyQuick("restore-chain-handoff-opponent-open-quick", opponentOpenOnly!.uid, 1, true));

    const openQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-handoff-turn-open-quick");
    expect(openQuick).toBeDefined();
    const opponentWindow = applyAndAssert(session, openQuick!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-chain-handoff-opponent-first-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-chain-handoff-opponent-second-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-chain-handoff-opponent-open-quick", "chainResponse")).toBe(false);

    const opponentFirstAction = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-handoff-opponent-first-chain-quick");
    expect(opponentFirstAction).toBeDefined();
    const turnWindow = applyAndAssert(session, opponentFirstAction!);
    expect(turnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(turnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-handoff-turn-open-quick", "restore-chain-handoff-opponent-first-chain-quick"]);
    expect(session.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(session, 1)).toEqual([]);
    expect(hasGroupedEffect(turnWindow.legalActionGroups, 0, "restore-chain-handoff-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedPass(turnWindow.legalActionGroups, 0)).toBe(true);

    const restoredTurnWindow = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restoredTurnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-handoff-turn-open-quick", "restore-chain-handoff-opponent-first-chain-quick"]);
    expect(restoredTurnWindow.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restoredTurnWindow, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredTurnWindow, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restoredTurnWindow, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredTurnWindow, 0), 0, "restore-chain-handoff-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredTurnWindow, 1), 1, "restore-chain-handoff-opponent-second-chain-quick", "chainResponse")).toBe(false);

    const staleOpponentFirst = applyResponse(restoredTurnWindow, opponentFirstAction!);
    expect(staleOpponentFirst.ok).toBe(false);
    expect(staleOpponentFirst.error).toContain("Response is not currently legal");
    expect(staleOpponentFirst.legalActions).toEqual(getDuelLegalActions(restoredTurnWindow, 0));
    expect(staleOpponentFirst.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTurnWindow, 0));

    const turnPass = getDuelLegalActions(restoredTurnWindow, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    const returnedOpponentWindow = applyAndAssert(restoredTurnWindow, turnPass!);
    expect(returnedOpponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(restoredTurnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-handoff-turn-open-quick", "restore-chain-handoff-opponent-first-chain-quick"]);
    expect(restoredTurnWindow.state.chainPasses).toEqual([0]);
    expect(getDuelLegalActions(restoredTurnWindow, 0)).toEqual([]);
    expect(hasGroupedEffect(returnedOpponentWindow.legalActionGroups, 1, "restore-chain-handoff-opponent-second-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(returnedOpponentWindow.legalActionGroups, 1, "restore-chain-handoff-opponent-open-quick", "chainResponse")).toBe(false);
    expect(hasGroupedPass(returnedOpponentWindow.legalActionGroups, 1)).toBe(true);

    const restoredOpponentWindow = restoreDuel(serializeDuel(restoredTurnWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentWindow)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(restoredOpponentWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-handoff-turn-open-quick", "restore-chain-handoff-opponent-first-chain-quick"]);
    expect(restoredOpponentWindow.state.chainPasses).toEqual([0]);
    expect(getDuelLegalActions(restoredOpponentWindow, 0)).toEqual([]);
    expect(getDuelLegalActions(restoredOpponentWindow, 1)).toEqual(getDuelLegalActions(restoredTurnWindow, 1));
    expect(getGroupedDuelLegalActions(restoredOpponentWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredTurnWindow, 1));
    expect(getGroupedDuelLegalActions(restoredOpponentWindow, 1).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpponentWindow, 1));

    const staleTurnPass = applyResponse(restoredOpponentWindow, turnPass!);
    expect(staleTurnPass.ok).toBe(false);
    expect(staleTurnPass.error).toContain("Response is not currently legal");
    expect(staleTurnPass.legalActions).toEqual(getDuelLegalActions(restoredOpponentWindow, 1));
    expect(staleTurnPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentWindow, 1));

    const opponentPass = getDuelLegalActions(restoredOpponentWindow, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const resolved = applyAndAssert(restoredOpponentWindow, opponentPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restoredOpponentWindow.state.chainPasses).toEqual([]);
    expect(restoredOpponentWindow.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-chain-handoff-opponent-first-chain-quick resolved",
      "restore-chain-handoff-turn-open-quick resolved",
    ]));
    expect(restoredOpponentWindow.state.log.map((entry) => entry.detail)).not.toContain("restore-chain-handoff-opponent-second-chain-quick resolved");
    expect(restoredOpponentWindow.state.log.map((entry) => entry.detail)).not.toContain("restore-chain-handoff-turn-chain-quick resolved");
    expect(getDuelLegalActions(restoredOpponentWindow, 1)).toEqual([]);

    const restoredOpenWindow = restoreDuel(serializeDuel(restoredOpponentWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainPasses).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredOpponentWindow, 0));
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
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

function findHandCard(session: ReturnType<typeof createDuel>, controller: 0 | 1, code: string) {
  return queryPublicState(session).cards.find((card) => card.controller === controller && card.location === "hand" && card.code === code);
}

function loggedEffect(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "quick",
    range: ["hand"],
    ...(oncePerTurn ? { oncePerTurn: true } : {}),
    operation(ctx) {
      ctx.log(`${id} resolved`);
    },
  };
}

function openOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, oncePerTurn),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

function chainOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, oncePerTurn),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-chain-handoff-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-chain-handoff-turn-chain-quick": restoreChainOnlyQuick(true),
    "restore-chain-handoff-opponent-first-chain-quick": restoreChainOnlyQuick(true),
    "restore-chain-handoff-opponent-second-chain-quick": restoreChainOnlyQuick(true),
    "restore-chain-handoff-opponent-open-quick": restoreOpenOnlyQuick(true),
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
