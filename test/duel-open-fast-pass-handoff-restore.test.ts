import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("open fast pass handoff restore", () => {
  it("restores open priority after an open fast effect has no legal response", () => {
    const session = createDuel({ seed: 263, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    expect(turnOpenQuick).toBeDefined();
    registerEffect(session, openOnlyQuick("restore-open-no-response-turn-quick", turnOpenQuick!.uid, 0, true));

    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-no-response-turn-quick");
    expect(quick).toBeDefined();
    const resolved = applyAndAssert(session, quick!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(session.state.chainPasses).toEqual([]);
    expect(session.state.log.map((entry) => entry.detail)).toContain("restore-open-no-response-turn-quick resolved");
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-no-response-turn-quick")).toBe(false);
    expect(getDuelLegalActions(session, 1)).toEqual([]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-no-response-turn-quick", "open")).toBe(false);
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 0), 0)).toBe(false);

    const staleQuick = applyResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
  });

  it("restores chain-response priority to the turn player after the opponent passes", () => {
    const session = createDuel({ seed: 262, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    const turnChainQuick = findHandCard(session, 0, "300");
    const opponentChainQuick = findHandCard(session, 1, "400");
    const opponentOpenQuick = findHandCard(session, 1, "500");
    expect(turnOpenQuick).toBeDefined();
    expect(turnChainQuick).toBeDefined();
    expect(opponentChainQuick).toBeDefined();
    expect(opponentOpenQuick).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-open-pass-turn-open-quick", turnOpenQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-open-pass-turn-chain-quick", turnChainQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-open-pass-opponent-chain-quick", opponentChainQuick!.uid, 1));
    registerEffect(session, openOnlyQuick("restore-open-pass-opponent-open-quick", opponentOpenQuick!.uid, 1));

    const openQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-pass-turn-open-quick");
    expect(openQuick).toBeDefined();
    const opponentWindow = applyAndAssert(session, openQuick!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-open-pass-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-open-pass-opponent-open-quick", "chainResponse")).toBe(false);

    const opponentPass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const turnWindow = applyAndAssert(session, opponentPass!);
    expect(turnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(session.state.chainPasses).toEqual([1]);
    expect(turnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-open-pass-turn-open-quick"]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restored.state.chain.map((link) => link.effectId)).toEqual(["restore-open-pass-turn-open-quick"]);
    expect(restored.state.chainPasses).toEqual([1]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-pass-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-pass-turn-open-quick", "chainResponse")).toBe(false);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 1), 1, "restore-open-pass-opponent-chain-quick", "chainResponse")).toBe(false);
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 0), 0)).toBe(true);

    const staleOpponentPass = applyResponse(restored, opponentPass!);
    expect(staleOpponentPass.ok).toBe(false);
    expect(staleOpponentPass.error).toContain("Response is not currently legal");
    expect(staleOpponentPass.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleOpponentPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));

    const turnPass = getDuelLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    const resolved = applyAndAssert(restored, turnPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-pass-turn-open-quick")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-pass-turn-chain-quick")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-pass-opponent-open-quick")).toBe(false);

    const restoredOpenWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restoredOpenWindow, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
  });

  it("restores chain-response priority to the turn player after the opponent chains", () => {
    const session = createDuel({ seed: 261, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "500"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    const turnChainQuick = findHandCard(session, 0, "300");
    const turnOpenOnly = findHandCard(session, 0, "500");
    const opponentChainQuick = findHandCard(session, 1, "400");
    expect(turnOpenQuick).toBeDefined();
    expect(turnChainQuick).toBeDefined();
    expect(turnOpenOnly).toBeDefined();
    expect(opponentChainQuick).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-open-alt-turn-open-quick", turnOpenQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-open-alt-turn-chain-quick", turnChainQuick!.uid, 0, true));
    registerEffect(session, openOnlyQuick("restore-open-alt-turn-open-only", turnOpenOnly!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-open-alt-opponent-chain-quick", opponentChainQuick!.uid, 1, true));

    const openQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-alt-turn-open-quick");
    expect(openQuick).toBeDefined();
    const opponentWindow = applyAndAssert(session, openQuick!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-open-alt-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 0, "restore-open-alt-turn-chain-quick", "chainResponse")).toBe(false);

    const opponentChain = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-alt-opponent-chain-quick");
    expect(opponentChain).toBeDefined();
    const turnWindow = applyAndAssert(session, opponentChain!);
    expect(turnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(turnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-open-alt-turn-open-quick", "restore-open-alt-opponent-chain-quick"]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restored.state.chain.map((link) => link.effectId)).toEqual(["restore-open-alt-turn-open-quick", "restore-open-alt-opponent-chain-quick"]);
    expect(restored.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-alt-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-alt-turn-open-only", "chainResponse")).toBe(false);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 1), 1, "restore-open-alt-opponent-chain-quick", "chainResponse")).toBe(false);
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 0), 0)).toBe(true);

    const staleOpponentChain = applyResponse(restored, opponentChain!);
    expect(staleOpponentChain.ok).toBe(false);
    expect(staleOpponentChain.error).toContain("Response is not currently legal");
    expect(staleOpponentChain.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleOpponentChain.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));

    const turnChain = getDuelLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-alt-turn-chain-quick");
    expect(turnChain).toBeDefined();
    const resolved = applyAndAssert(restored, turnChain!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-open-alt-turn-chain-quick resolved",
      "restore-open-alt-opponent-chain-quick resolved",
      "restore-open-alt-turn-open-quick resolved",
    ]));
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-alt-turn-open-quick")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-alt-turn-chain-quick")).toBe(false);

    const restoredOpenWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restoredOpenWindow, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restored, 0));
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

function loggedEffect(id: string, sourceUid: string, controller: 0 | 1, detail: string, oncePerTurn = false): DuelEffectDefinition {
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
      ctx.log(detail);
    },
  };
}

function openOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, "open", oncePerTurn),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

function chainOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, "chain", oncePerTurn),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-open-no-response-turn-quick": restoreOpenOnlyQuick(true),
    "restore-open-pass-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-open-pass-turn-chain-quick": restoreChainOnlyQuick(true),
    "restore-open-pass-opponent-chain-quick": restoreChainOnlyQuick(),
    "restore-open-pass-opponent-open-quick": restoreOpenOnlyQuick(),
    "restore-open-alt-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-open-alt-turn-chain-quick": restoreChainOnlyQuick(true),
    "restore-open-alt-turn-open-only": restoreOpenOnlyQuick(),
    "restore-open-alt-opponent-chain-quick": restoreChainOnlyQuick(true),
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
