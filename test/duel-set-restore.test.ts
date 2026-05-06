import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
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

describe("set action restore", () => {
  it("restores monster sets to turn-player open fast-effect priority", () => {
    const session = createDuel({ seed: 267, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "500"] },
    });
    startDuel(session);

    const setMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnQuick = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuick = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(setMonster).toBeTruthy();
    expect(turnQuick).toBeTruthy();
    expect(opponentQuick).toBeTruthy();
    registerEffect(session, openOnlyQuick("restore-set-turn-open-quick", turnQuick!.uid, 0));
    registerEffect(session, openOnlyQuick("restore-set-opponent-open-quick", opponentQuick!.uid, 1));

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === setMonster!.uid);
    expect(action).toBeDefined();
    const result = applyResponse(session, action!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(result.legalActions.some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-set-turn-open-quick")).toBe(true);
    expect(getDuelLegalActions(session, 1)).toEqual([]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-set-turn-open-quick": restoreOpenOnlyQuick,
      "restore-set-opponent-open-quick": restoreOpenOnlyQuick,
    });
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(restored.state.cards.find((card) => card.uid === setMonster!.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });
    expect(restored.state.players[0].normalSummonAvailable).toBe(false);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-set-turn-open-quick")).toBe(true);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-set-opponent-open-quick")).toBe(false);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "normalSummon" || candidate.type === "setMonster")).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));

    const staleSet = applyResponse(restored, action!);
    expect(staleSet.ok).toBe(false);
    expect(staleSet.error).toContain("Response is not currently legal");
    assertRestoreLegalWindow(restored, staleSet, 0);
  });

  it("restores spell/trap sets to turn-player open fast-effect priority", () => {
    const session = createDuel({ seed: 268, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["200", "300", "500"] },
      1: { main: ["400", "500", "500"] },
    });
    startDuel(session);

    const setSpell = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const turnQuick = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuick = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(setSpell).toBeTruthy();
    expect(turnQuick).toBeTruthy();
    expect(opponentQuick).toBeTruthy();
    registerEffect(session, openOnlyQuick("restore-spell-set-turn-open-quick", turnQuick!.uid, 0));
    registerEffect(session, openOnlyQuick("restore-spell-set-opponent-open-quick", opponentQuick!.uid, 1));

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setSpellTrap" && candidate.uid === setSpell!.uid);
    expect(action).toBeDefined();
    const result = applyResponse(session, action!);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(result.legalActions.some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-spell-set-turn-open-quick")).toBe(true);
    expect(getDuelLegalActions(session, 1)).toEqual([]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-spell-set-turn-open-quick": restoreOpenOnlyQuick,
      "restore-spell-set-opponent-open-quick": restoreOpenOnlyQuick,
    });
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(restored.state.cards.find((card) => card.uid === setSpell!.uid)).toMatchObject({ location: "spellTrapZone", position: "faceDown", faceUp: false });
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-spell-set-turn-open-quick")).toBe(true);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-spell-set-opponent-open-quick")).toBe(false);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "setSpellTrap" && candidate.uid === setSpell!.uid)).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));

    const staleSet = applyResponse(restored, action!);
    expect(staleSet.ok).toBe(false);
    expect(staleSet.error).toContain("Response is not currently legal");
    assertRestoreLegalWindow(restored, staleSet, 0);
  });

  it("restores tribute sets to turn-player open fast-effect priority", () => {
    const session = createDuel({ seed: 269, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["600", "100", "300"] },
      1: { main: ["400", "500", "500"] },
    });
    startDuel(session);

    const setMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "600");
    const tribute = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnQuick = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentQuick = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(setMonster).toBeTruthy();
    expect(tribute).toBeTruthy();
    expect(turnQuick).toBeTruthy();
    expect(opponentQuick).toBeTruthy();
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);
    registerEffect(session, openOnlyQuick("restore-tribute-set-turn-open-quick", turnQuick!.uid, 0));
    registerEffect(session, openOnlyQuick("restore-tribute-set-opponent-open-quick", opponentQuick!.uid, 1));

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "tributeSet" && candidate.uid === setMonster!.uid && candidate.tributeUids.includes(tribute!.uid));
    expect(action?.type).toBe("tributeSet");
    if (!action || action.type !== "tributeSet") throw new Error("Expected Tribute Set action");
    const result = applyResponse(session, action);
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(result.legalActions.some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-tribute-set-turn-open-quick")).toBe(true);
    expect(getDuelLegalActions(session, 1)).toEqual([]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-tribute-set-turn-open-quick": restoreOpenOnlyQuick,
      "restore-tribute-set-opponent-open-quick": restoreOpenOnlyQuick,
    });
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(restored.state.cards.find((card) => card.uid === tribute!.uid)?.location).toBe("graveyard");
    expect(restored.state.cards.find((card) => card.uid === setMonster!.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });
    expect(restored.state.players[0].normalSummonAvailable).toBe(false);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-tribute-set-turn-open-quick")).toBe(true);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "restore-tribute-set-opponent-open-quick")).toBe(false);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "tributeSet" && candidate.uid === setMonster!.uid)).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));

    const staleSet = applyResponse(restored, action);
    expect(staleSet.ok).toBe(false);
    expect(staleSet.error).toContain("Response is not currently legal");
    assertRestoreLegalWindow(restored, staleSet, 0);
  });

  it("restores monster set legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === monster!.uid);
    expect(action).toBeDefined();
    expect(action).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "open" });

    const staleResult = applyResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    assertRestoreLegalWindow(restored, staleResult, 0);
    expect(restored.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "hand" });
    expect(restored.state.log.some((entry) => entry.action === "setMonster" && entry.card === "Normal Test Monster")).toBe(false);

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });
    expect(result.state.players[0].normalSummonAvailable).toBe(false);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    assertRestoreLegalWindow(restored, result, result.state.waitingFor!);
    expect(result.state.log.some((entry) => entry.action === "setMonster" && entry.card === "Normal Test Monster")).toBe(true);
    const staleReplay = applyResponse(restored, action!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    expect(staleReplay.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    assertRestoreLegalWindow(restored, staleReplay, staleReplay.state.waitingFor!);
  });

  it("restores spell/trap set legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["200"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const spell = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(spell).toBeTruthy();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "setSpellTrap" && candidate.uid === spell!.uid);
    expect(action).toBeDefined();
    expect(action).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "open" });

    const staleResult = applyResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    assertRestoreLegalWindow(restored, staleResult, 0);
    expect(restored.state.cards.find((card) => card.uid === spell!.uid)).toMatchObject({ location: "hand" });
    expect(restored.state.log.some((entry) => entry.action === "set" && entry.card === "Test Spell")).toBe(false);

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === spell!.uid)).toMatchObject({ location: "spellTrapZone", position: "faceDown", faceUp: false });
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    assertRestoreLegalWindow(restored, result, result.state.waitingFor!);
    expect(result.state.log.some((entry) => entry.action === "set" && entry.card === "Test Spell")).toBe(true);
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
