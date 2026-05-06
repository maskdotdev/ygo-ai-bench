import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("position action restore", () => {
  it("restores manual position changes to turn-player open fast-effect priority", () => {
    const session = createDuel({ seed: 269, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "500"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnQuick = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuick = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(monster).toBeTruthy();
    expect(turnQuick).toBeTruthy();
    expect(opponentQuick).toBeTruthy();
    const fieldMonster = moveDuelCard(session.state, monster!.uid, "monsterZone", 0);
    fieldMonster.position = "faceUpAttack";
    fieldMonster.faceUp = true;
    registerEffect(session, openOnlyQuick("restore-position-turn-open-quick", turnQuick!.uid, 0));
    registerEffect(session, openOnlyQuick("restore-position-opponent-open-quick", opponentQuick!.uid, 1));

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePosition" && candidate.uid === monster!.uid && candidate.position === "faceUpDefense");
    expect(action).toBeDefined();
    const result = applyAndAssert(session, action!);
    expect(result.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(result.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpDefense", faceUp: true });
    expect(session.state.positionsChanged).toEqual([monster!.uid]);
    expect(result.legalActions.some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-position-turn-open-quick")).toBe(true);
    expect(result.legalActions.some((candidate) => candidate.type === "changePosition" && candidate.uid === monster!.uid)).toBe(false);
    expect(getDuelLegalActions(session, 1)).toEqual([]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-position-turn-open-quick": restoreOpenOnlyQuick,
      "restore-position-opponent-open-quick": restoreOpenOnlyQuick,
    });
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(restored.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpDefense", faceUp: true });
    expect(restored.state.positionsChanged).toEqual([monster!.uid]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-position-turn-open-quick")).toBe(true);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-position-opponent-open-quick")).toBe(false);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "changePosition" && candidate.uid === monster!.uid)).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));

    const stalePosition = applyResponse(restored, action!);
    expect(stalePosition.ok).toBe(false);
    expect(stalePosition.error).toContain("Response is not currently legal");
    expect(stalePosition.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(stalePosition.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
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
