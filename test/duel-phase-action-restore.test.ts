import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

function expectCurrentWindowMetadata(session: ReturnType<typeof restoreDuel>, response: ReturnType<typeof applyResponse>): void {
  for (const action of response.legalActions) expect(action).toMatchObject({ windowId: session.state.actionWindowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId: session.state.actionWindowId, windowKind: response.state.windowKind });
}

function assertRestoreLegalWindow(session: ReturnType<typeof restoreDuel>, response: ReturnType<typeof applyResponse>, player: 0 | 1): void {
  expect(response.state.actionWindowId).toBe(session.state.actionWindowId);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  expectCurrentWindowMetadata(session, response);
}

describe("phase action restore", () => {
  it("restores phase changes to turn-player open priority without open fast effects", () => {
    const session = createDuel({ seed: 265, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const turnQuick = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const opponentQuick = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(turnQuick).toBeDefined();
    expect(opponentQuick).toBeDefined();
    registerEffect(session, openOnlyQuick("restore-phase-turn-open-quick", turnQuick!.uid, 0));
    registerEffect(session, openOnlyQuick("restore-phase-opponent-open-quick", opponentQuick!.uid, 1));

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    const changed = applyResponse(session, battle!);
    expect(changed.ok, changed.error).toBe(true);
    expect(changed.state).toMatchObject({ waitingFor: 0, windowKind: "open", phase: "battle", chain: [], pendingTriggers: [] });
    expect(changed.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-phase-turn-open-quick")).toBe(false);
    expect(getDuelLegalActions(session, 1)).toEqual([]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-phase-turn-open-quick": restoreOpenOnlyQuick,
      "restore-phase-opponent-open-quick": restoreOpenOnlyQuick,
    });
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "open", phase: "battle", chain: [], pendingTriggers: [] });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.effectId === "restore-phase-turn-open-quick")).toBe(false);
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "activateEffect" && action.effectId === "restore-phase-opponent-open-quick")).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 0).some((group) => group.actions.some((action) => action.type === "activateEffect"))).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));

    const staleBattle = applyResponse(restored, battle!);
    expect(staleBattle.ok).toBe(false);
    expect(staleBattle.error).toContain("Response is not currently legal");
    expect(staleBattle.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleBattle.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    assertRestoreLegalWindow(restored, staleBattle, 0);
  });

  it("restores phase change legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(action).toBeDefined();
    expect(action).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "open" });

    const staleResult = applyResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    assertRestoreLegalWindow(restored, staleResult, 0);
    expect(restored.state.phase).toBe("main1");
    expect(restored.state.log.some((entry) => entry.action === "phase" && entry.detail === "Moved to battle")).toBe(false);

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("battle");
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    assertRestoreLegalWindow(restored, result, result.state.waitingFor!);
    expect(result.state.log.some((entry) => entry.action === "phase" && entry.detail === "Moved to battle")).toBe(true);
    const staleReplay = applyResponse(restored, action!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    expect(staleReplay.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    assertRestoreLegalWindow(restored, staleReplay, staleReplay.state.waitingFor!);
  });

  it("restores end turn legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "endTurn");
    expect(action).toBeDefined();
    expect(action).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "open" });

    const staleResult = applyResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    assertRestoreLegalWindow(restored, staleResult, 0);
    expect(restored.state.turnPlayer).toBe(0);
    expect(restored.state.turn).toBe(1);
    expect(restored.state.phase).toBe("main1");
    expect(restored.state.log.some((entry) => entry.action === "turn" && entry.player === 1)).toBe(false);

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.turnPlayer).toBe(1);
    expect(result.state.turn).toBe(2);
    expect(result.state.phase).toBe("main1");
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    assertRestoreLegalWindow(restored, result, result.state.waitingFor!);
    expect(result.state.log.some((entry) => entry.action === "turn" && entry.player === 1)).toBe(true);
    const staleReplay = applyResponse(restored, action!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    expect(staleReplay.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    assertRestoreLegalWindow(restored, staleReplay, staleReplay.state.waitingFor!);
  });
});

function openOnlyQuick(id: string, sourceUid: string, controller: 0 | 1): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "quick",
    range: ["hand"],
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
    operation(ctx) {
      ctx.log(`${id} resolved`);
    },
  };
}

function restoreOpenOnlyQuick(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...effect,
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
    operation(ctx) {
      ctx.log(`${effect.id} resolved`);
    },
  };
}
