import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("chain priority restore", () => {
  it("keeps restored chain response priority with the last activating player", () => {
    const session = createDuel({ seed: 333, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const publicState = queryPublicState(session);
    const starterSource = publicState.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const playerQuickA = publicState.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const playerQuickB = publicState.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const opponentQuick = publicState.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(starterSource).toBeTruthy();
    expect(playerQuickA).toBeTruthy();
    expect(playerQuickB).toBeTruthy();
    expect(opponentQuick).toBeTruthy();

    registerEffect(session, loggedEffect("restore-priority-starter", starterSource!.uid, 0, "ignition", "Restored priority starter resolved"));
    registerEffect(session, loggedEffect("restore-player-quick-a", playerQuickA!.uid, 0, "quick", "Restored player quick A resolved"));
    registerEffect(session, loggedEffect("restore-player-quick-b", playerQuickB!.uid, 0, "quick", "Restored player quick B resolved"));
    registerEffect(session, loggedEffect("restore-opponent-quick", opponentQuick!.uid, 1, "quick", "Restored opponent quick resolved", true));

    const starter = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-priority-starter");
    expect(starter).toBeTruthy();
    expect(applyAndAssert(session, starter!).state.waitingFor).toBe(1);
    const opponent = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-opponent-quick");
    expect(opponent).toBeTruthy();
    expect(applyAndAssert(session, opponent!).state.waitingFor).toBe(0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restored.state.chain.map((link) => link.effectId)).toEqual(["restore-priority-starter", "restore-opponent-quick"]);
    expect(restored.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-player-quick-a")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-player-quick-b")).toBe(true);
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 0), 0)).toBe(true);

    const playerA = getDuelLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-player-quick-a");
    expect(playerA).toBeTruthy();
    const stalePlayerA = applyResponse(restored, { ...playerA!, windowId: playerA!.windowId! - 1 });
    expect(stalePlayerA.ok).toBe(false);
    expect(stalePlayerA.error).toContain("Response is not currently legal");
    expect(stalePlayerA.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(stalePlayerA.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));

    const afterPlayerA = applyAndAssert(restored, playerA!);
    expect(afterPlayerA.state.chain.map((link) => link.effectId)).toEqual(["restore-priority-starter", "restore-opponent-quick", "restore-player-quick-a"]);
    expect(afterPlayerA.state.waitingFor).toBe(0);
    expect(restored.state.chainPasses).toEqual([]);
    expect(hasGroupedEffect(afterPlayerA.legalActionGroups, 0, "restore-player-quick-b")).toBe(true);
    expect(hasGroupedPass(afterPlayerA.legalActionGroups, 0)).toBe(true);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
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

function loggedEffect(id: string, sourceUid: string, controller: 0 | 1, event: "ignition" | "quick", detail: string, oncePerTurn = false): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event,
    range: ["hand"],
    ...(oncePerTurn ? { oncePerTurn: true } : {}),
    operation(ctx) {
      ctx.log(detail);
    },
  };
}

function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-priority-starter": restoreLoggedEffect("Restored priority starter resolved"),
    "restore-player-quick-a": restoreLoggedEffect("Restored player quick A resolved"),
    "restore-player-quick-b": restoreLoggedEffect("Restored player quick B resolved"),
    "restore-opponent-quick": restoreLoggedEffect("Restored opponent quick resolved"),
  };
}

function restoreLoggedEffect(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...effect,
    operation(ctx) {
      ctx.log(detail);
    },
  });
}

function hasGroupedEffect(groups: ReturnType<typeof getGroupedDuelLegalActions>, player: 0 | 1, effectId: string): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "chainResponse" &&
      group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowId === group.windowId && action.windowKind === "chainResponse"),
  );
}

function hasGroupedPass(groups: ReturnType<typeof getGroupedDuelLegalActions>, player: 0 | 1): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "chainResponse" &&
      group.actions.some((action) => action.type === "passChain" && action.player === player && action.windowId === group.windowId && action.windowKind === "chainResponse"),
  );
}
