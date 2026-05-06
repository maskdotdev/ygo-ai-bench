import { describe, expect, it } from "vitest";
import { applyResponse, canSpecialSummonDuelCard, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData, DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

function assertRestoreLegalWindow(restored: ReturnType<typeof restoreDuel>, response: ReturnType<typeof applyResponse>, player: 0 | 1): void {
  const windowId = restored.state.actionWindowId;
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}

describe("pendulum restore", () => {
  it("restores face-up extra deck pendulum state and direct special summon legality", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["350"], extra: ["980"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const pendulum = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "350");
    const extra = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    expect(pendulum).toBeTruthy();
    expect(extra).toBeTruthy();
    moveDuelCard(session.state, pendulum!.uid, "extraDeck", 0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "extraDeck", faceUp: true, position: "faceDown" });
    expect(restored.state.cards.find((card) => card.uid === extra!.uid)).toMatchObject({ location: "extraDeck", faceUp: false, position: "faceDown" });
    expect(canSpecialSummonDuelCard(restored.state, pendulum!.uid, 0)).toBe(true);
    expect(canSpecialSummonDuelCard(restored.state, extra!.uid, 0)).toBe(false);
    expect(() => specialSummonDuelCard(restored.state, extra!.uid, 0)).toThrow("cannot be Special Summoned");

    const summoned = specialSummonDuelCard(restored.state, pendulum!.uid, 0);
    expect(summoned).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack", summonType: "special" });
    expect(restored.state.log.some((entry) => entry.action === "specialSummon" && entry.card === "Pendulum Test Monster")).toBe(true);
  });

  it("restores Pendulum Summon legal actions and rejects stale restored responses", () => {
    const pendulumCards: DuelCardData[] = [
      { code: "100", name: "Low Restore Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "200", name: "High Restore Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
      { code: "300", name: "Restored Extra Pendulum", kind: "monster", typeFlags: 0x1000001, level: 4 },
      { code: "400", name: "Restored Pendulum Watcher", kind: "monster", level: 4 },
      { code: "500", name: "Restored Hand Pendulum", kind: "monster", typeFlags: 0x1000001, level: 5 },
    ];
    const session = createDuel({ seed: 252, startingHandSize: 5, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500"] },
      1: { main: [] },
    });
    startDuel(session);

    const low = session.state.cards.find((card) => card.code === "100");
    const high = session.state.cards.find((card) => card.code === "200");
    const candidate = session.state.cards.find((card) => card.code === "300");
    const watcher = session.state.cards.find((card) => card.code === "400");
    const handCandidate = session.state.cards.find((card) => card.code === "500");
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(candidate).toBeDefined();
    expect(watcher).toBeDefined();
    expect(handCandidate).toBeDefined();
    moveDuelCard(session.state, low!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, high!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, candidate!.uid, "monsterZone", 0);
    moveDuelCard(session.state, candidate!.uid, "extraDeck", 0);
    registerEffect(session, summonSuccessWatcher("restore-pendulum-success-watcher", watcher!.uid, "Restored Pendulum success watcher resolved"));

    const restored = restoreDuel(serializeDuel(session), createCardReader(pendulumCards), {
      "restore-pendulum-success-watcher": restoreSummonSuccessWatcher("Restored Pendulum success watcher resolved"),
    });
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual([]);
    const action = getDuelLegalActions(restored, 0).find((candidateAction) => candidateAction.type === "pendulumSummon" && candidateAction.summonUids.includes(candidate!.uid));
    expect(action).toMatchObject({ type: "pendulumSummon", summonUids: [handCandidate!.uid, candidate!.uid], windowId: queryPublicState(restored).actionWindowId, windowKind: "open" });
    if (!action || action.type !== "pendulumSummon") throw new Error("Expected restored Pendulum Summon action");
    expect(
      getGroupedDuelLegalActions(restored, 0).some(
        (group) =>
          group.label === "Summons" &&
          group.actions.some((groupAction) => groupAction.type === "pendulumSummon" && groupAction.summonUids.length === 2 && groupAction.summonUids.includes(handCandidate!.uid) && groupAction.summonUids.includes(candidate!.uid)),
      ),
    ).toBe(true);

    const staleBeforeSummon = applyResponse(restored, { ...action, windowId: action.windowId! - 1 });
    expect(staleBeforeSummon.ok).toBe(false);
    expect(staleBeforeSummon.error).toContain("Response is not currently legal");
    expect(staleBeforeSummon.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeSummon.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleBeforeSummon.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    assertRestoreLegalWindow(restored, staleBeforeSummon, 0);
    expect(restored.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "extraDeck", faceUp: true });
    expect(restored.state.players[0].pendulumSummonAvailable).toBe(true);

    const result = applyResponse(restored, { ...action, summonUids: [candidate!.uid] });
    expect(result.ok).toBe(true);
    expect(restored.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum", faceUp: true });
    expect(restored.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(result.state.pendingTriggers).toEqual([expect.objectContaining({ effectId: "restore-pendulum-success-watcher", eventName: "specialSummoned", eventCardUid: candidate!.uid })]);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    assertRestoreLegalWindow(restored, result, result.state.waitingFor!);
    const staleResult = applyResponse(restored, action);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, staleResult.state.waitingFor!));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, staleResult.state.waitingFor!));
    assertRestoreLegalWindow(restored, staleResult, staleResult.state.waitingFor!);

    const restoredTriggerWindow = restoreDuel(serializeDuel(restored), createCardReader(pendulumCards), {
      "restore-pendulum-success-watcher": restoreSummonSuccessWatcher("Restored Pendulum success watcher resolved"),
    });
    expect(restoredTriggerWindow.state.pendingTriggers).toEqual(restored.state.pendingTriggers);
    expect(restoredTriggerWindow.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum", faceUp: true });
    const trigger = getDuelLegalActions(restoredTriggerWindow, 0).find((candidateAction) => candidateAction.type === "activateTrigger" && candidateAction.effectId === "restore-pendulum-success-watcher");
    expect(trigger).toBeDefined();
    expectGroupedTrigger(restoredTriggerWindow, "restore-pendulum-success-watcher");
    const staleBeforeTrigger = applyResponse(restoredTriggerWindow, { ...trigger!, windowId: trigger!.windowId! - 1 });
    expect(staleBeforeTrigger.ok).toBe(false);
    expect(staleBeforeTrigger.error).toContain("Response is not currently legal");
    expect(staleBeforeTrigger.state.actionWindowId).toBe(restoredTriggerWindow.state.actionWindowId);
    expect(staleBeforeTrigger.legalActions).toEqual(getDuelLegalActions(restoredTriggerWindow, 0));
    expect(staleBeforeTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerWindow, 0));
    assertRestoreLegalWindow(restoredTriggerWindow, staleBeforeTrigger, 0);

    const triggerResult = applyResponse(restoredTriggerWindow, trigger!);
    expect(triggerResult.ok, triggerResult.error).toBe(true);
    expect(triggerResult.state.pendingTriggers).toEqual([]);
    expect(triggerResult.state.log.some((entry) => entry.detail === "Restored Pendulum success watcher resolved")).toBe(true);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restoredTriggerWindow, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerWindow, triggerResult.state.waitingFor!));
    assertRestoreLegalWindow(restoredTriggerWindow, triggerResult, triggerResult.state.waitingFor!);
    const staleTrigger = applyResponse(restoredTriggerWindow, trigger!);
    expect(staleTrigger.ok).toBe(false);
    expect(staleTrigger.error).toContain("Response is not currently legal");
    expect(staleTrigger.state.actionWindowId).toBe(restoredTriggerWindow.state.actionWindowId);
    expect(staleTrigger.legalActions).toEqual(getDuelLegalActions(restoredTriggerWindow, staleTrigger.state.waitingFor!));
    expect(staleTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerWindow, staleTrigger.state.waitingFor!));
    assertRestoreLegalWindow(restoredTriggerWindow, staleTrigger, staleTrigger.state.waitingFor!);
  });

  it("restores triggerless Pendulum Summons to turn-player open fast-effect priority", () => {
    const pendulumCards: DuelCardData[] = [
      { code: "100", name: "Low Open Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "200", name: "High Open Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
      { code: "300", name: "Open Pendulum Candidate", kind: "monster", typeFlags: 0x1000001, level: 4 },
      { code: "400", name: "Turn Open Quick", kind: "monster", level: 4 },
      { code: "500", name: "Opponent Open Quick", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 253, startingHandSize: 4, cardReader: createCardReader(pendulumCards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400"] },
      1: { main: ["500"] },
    });
    startDuel(session);

    const low = session.state.cards.find((card) => card.code === "100");
    const high = session.state.cards.find((card) => card.code === "200");
    const candidate = session.state.cards.find((card) => card.code === "300");
    const turnQuick = session.state.cards.find((card) => card.code === "400");
    const opponentQuick = session.state.cards.find((card) => card.code === "500");
    expect(low).toBeDefined();
    expect(high).toBeDefined();
    expect(candidate).toBeDefined();
    expect(turnQuick).toBeDefined();
    expect(opponentQuick).toBeDefined();
    moveDuelCard(session.state, low!.uid, "spellTrapZone", 0).sequence = 0;
    moveDuelCard(session.state, high!.uid, "spellTrapZone", 0).sequence = 1;
    registerEffect(session, openOnlyQuick("restore-pendulum-open-turn-quick", turnQuick!.uid, 0));
    registerEffect(session, openOnlyQuick("restore-pendulum-open-opponent-quick", opponentQuick!.uid, 1));

    const action = getDuelLegalActions(session, 0).find((candidateAction) => candidateAction.type === "pendulumSummon" && candidateAction.summonUids.includes(candidate!.uid));
    expect(action?.type).toBe("pendulumSummon");
    if (!action || action.type !== "pendulumSummon") throw new Error("Expected Pendulum Summon action");
    const result = applyResponse(session, { ...action, summonUids: [candidate!.uid] });
    expect(result.ok, result.error).toBe(true);
    expect(result.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(result.legalActions.some((candidateAction) => candidateAction.type === "activateEffect" && candidateAction.effectId === "restore-pendulum-open-turn-quick")).toBe(true);
    expect(getDuelLegalActions(session, 1)).toEqual([]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(pendulumCards), {
      "restore-pendulum-open-turn-quick": restoreOpenOnlyQuick,
      "restore-pendulum-open-opponent-quick": restoreOpenOnlyQuick,
    });
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(restored.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum", faceUp: true });
    expect(restored.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0).some((candidateAction) => candidateAction.type === "activateEffect" && candidateAction.effectId === "restore-pendulum-open-turn-quick")).toBe(true);
    expect(getDuelLegalActions(restored, 0).some((candidateAction) => candidateAction.type === "activateEffect" && candidateAction.effectId === "restore-pendulum-open-opponent-quick")).toBe(false);
    expect(getDuelLegalActions(restored, 0).some((candidateAction) => candidateAction.type === "pendulumSummon" && candidateAction.summonUids.includes(candidate!.uid))).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));

    const staleSummon = applyResponse(restored, action);
    expect(staleSummon.ok).toBe(false);
    expect(staleSummon.error).toContain("Response is not currently legal");
    assertRestoreLegalWindow(restored, staleSummon, 0);
  });
});

function summonSuccessWatcher(id: string, sourceUid: string, detail: string): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller: 0,
    event: "trigger",
    triggerEvent: "specialSummoned",
    range: ["hand"],
    operation(ctx) {
      ctx.log(detail);
    },
  };
}

function restoreSummonSuccessWatcher(detail: string): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...effect,
    operation(ctx) {
      ctx.log(detail);
    },
  });
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

function expectGroupedTrigger(restored: ReturnType<typeof restoreDuel>, effectId: string): void {
  const windowId = restored.state.actionWindowId;
  expect(
    getGroupedDuelLegalActions(restored, 0).some(
      (group) =>
        group.windowId === windowId &&
        group.windowKind === "triggerBucket" &&
        group.triggerBucket?.triggerBucket === "turnOptional" &&
        group.actions.some((action) => action.type === "activateTrigger" && action.effectId === effectId && action.windowId === windowId && action.windowKind === "triggerBucket"),
    ),
  ).toBe(true);
}
