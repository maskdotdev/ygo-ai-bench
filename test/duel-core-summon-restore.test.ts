import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition, DuelResponse } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

function expectRestoredOpenAction(restored: ReturnType<typeof restoreDuel>, action: NonNullable<Parameters<typeof applyResponse>[1]> | undefined): void {
  expect(action).toBeDefined();
  if (action === undefined) return;
  expect(action).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "open" });
  expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toContainEqual(action);
  expect(getDuelLegalActions(restored, 1)).toEqual([]);
  expect(getGroupedDuelLegalActions(restored, 1)).toEqual([]);
}

function assertRestoreLegalWindow(restored: ReturnType<typeof restoreDuel>, response: ReturnType<typeof applyResponse>, player: 0 | 1): void {
  const windowId = restored.state.actionWindowId;
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const legalAction of response.legalActions) expect(legalAction).toMatchObject({ windowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: response.state.windowKind });
}

function expectStaleRestoredResponseRejected(restored: ReturnType<typeof restoreDuel>, action: NonNullable<Parameters<typeof applyResponse>[1]>): void {
  const staleResult = applyResponse(restored, action);
  expect(staleResult.ok).toBe(false);
  expect(staleResult.error).toContain("Response is not currently legal");
  assertRestoreLegalWindow(restored, staleResult, staleResult.state.waitingFor!);
}

function expectStalePreviousWindowRejected(restored: ReturnType<typeof restoreDuel>, action: DuelResponse, player: 0 | 1): void {
  const staleResult = applyResponse(restored, { ...action, windowId: action.windowId! - 1 });
  expect(staleResult.ok).toBe(false);
  expect(staleResult.error).toContain("Response is not currently legal");
  assertRestoreLegalWindow(restored, staleResult, player);
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

describe("core summon restore", () => {
  it("restores Normal Summon legal actions and applies the restored action", () => {
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
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === monster!.uid);
    expectRestoredOpenAction(restored, action);

    const staleBeforeSummon = applyResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleBeforeSummon.ok).toBe(false);
    expect(staleBeforeSummon.error).toContain("Response is not currently legal");
    expect(staleBeforeSummon.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeSummon.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleBeforeSummon.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    assertRestoreLegalWindow(restored, staleBeforeSummon, 0);
    expect(restored.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "hand" });
    expect(restored.state.players[0].normalSummonAvailable).toBe(true);

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(result.state.players[0].normalSummonAvailable).toBe(false);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    assertRestoreLegalWindow(restored, result, result.state.waitingFor!);
    expectStaleRestoredResponseRejected(restored, action!);
  });

  it("restores Tribute Summon legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["600", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "600");
    const tribute = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tributeMonster).toBeTruthy();
    expect(tribute).toBeTruthy();
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "tributeSummon" && candidate.uid === tributeMonster!.uid && candidate.tributeUids.includes(tribute!.uid));
    expect(action?.type).toBe("tributeSummon");
    if (!action || action.type !== "tributeSummon") throw new Error("Expected restored Tribute Summon action");
    expectRestoredOpenAction(restored, action);

    const staleBeforeSummon = applyResponse(restored, { ...action, windowId: action.windowId! - 1 });
    expect(staleBeforeSummon.ok).toBe(false);
    expect(staleBeforeSummon.error).toContain("Response is not currently legal");
    expect(staleBeforeSummon.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeSummon.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleBeforeSummon.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    assertRestoreLegalWindow(restored, staleBeforeSummon, 0);
    expect(restored.state.cards.find((card) => card.uid === tribute!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.state.cards.find((card) => card.uid === tributeMonster!.uid)).toMatchObject({ location: "hand" });
    expect(restored.state.players[0].normalSummonAvailable).toBe(true);

    const result = applyResponse(restored, action);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === tribute!.uid)?.location).toBe("graveyard");
    expect(result.state.cards.find((card) => card.uid === tributeMonster!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(result.state.players[0].normalSummonAvailable).toBe(false);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    assertRestoreLegalWindow(restored, result, result.state.waitingFor!);
    expectStaleRestoredResponseRejected(restored, action);
  });

  it("restores Flip Summon legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["300"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(monster).toBeTruthy();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceDownDefense";
    session.state.cards.find((card) => card.uid === monster!.uid)!.faceUp = false;

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === monster!.uid);
    expectRestoredOpenAction(restored, action);

    const staleBeforeSummon = applyResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleBeforeSummon.ok).toBe(false);
    expect(staleBeforeSummon.error).toContain("Response is not currently legal");
    expect(staleBeforeSummon.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeSummon.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleBeforeSummon.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    assertRestoreLegalWindow(restored, staleBeforeSummon, 0);
    expect(restored.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack", faceUp: true });
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    assertRestoreLegalWindow(restored, result, result.state.waitingFor!);
    expectStaleRestoredResponseRejected(restored, action!);
  });

  it("restores Ritual Summon legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300", "500"] },
      1: { main: ["400", "400", "400", "400"] },
    });
    startDuel(session);

    const ritual = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const watcher = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(ritual).toBeTruthy();
    expect(watcher).toBeTruthy();
    registerEffect(session, summonSuccessWatcher("restore-ritual-success-watcher", watcher!.uid, "Restored Ritual success watcher resolved"));
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restore-ritual-success-watcher": restoreSummonSuccessWatcher("Restored Ritual success watcher resolved"),
    });
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "ritualSummon" && candidate.uid === ritual!.uid);
    expect(action?.type).toBe("ritualSummon");
    if (!action || action.type !== "ritualSummon") throw new Error("Expected restored Ritual Summon action");
    expectRestoredOpenAction(restored, action);

    const staleBeforeSummon = applyResponse(restored, { ...action, windowId: action.windowId! - 1 });
    expect(staleBeforeSummon.ok).toBe(false);
    expect(staleBeforeSummon.error).toContain("Response is not currently legal");
    expect(staleBeforeSummon.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeSummon.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleBeforeSummon.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    assertRestoreLegalWindow(restored, staleBeforeSummon, 0);
    expect(restored.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({ location: "hand" });
    expect(action.materialUids.every((uid) => restored.state.cards.find((card) => card.uid === uid)?.location === "hand")).toBe(true);

    const result = applyResponse(restored, action);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.pendingTriggers).toEqual([expect.objectContaining({ effectId: "restore-ritual-success-watcher", eventName: "specialSummoned", eventCardUid: ritual!.uid })]);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    assertRestoreLegalWindow(restored, result, result.state.waitingFor!);
    expectStaleRestoredResponseRejected(restored, action);

    const restoredTriggerWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), {
      "restore-ritual-success-watcher": restoreSummonSuccessWatcher("Restored Ritual success watcher resolved"),
    });
    expect(restoredTriggerWindow.state.pendingTriggers).toEqual(restored.state.pendingTriggers);
    const trigger = getDuelLegalActions(restoredTriggerWindow, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "restore-ritual-success-watcher");
    expect(trigger).toBeDefined();
    expectGroupedTrigger(restoredTriggerWindow, "restore-ritual-success-watcher");
    expectStalePreviousWindowRejected(restoredTriggerWindow, trigger!, 0);
    const triggerResult = applyResponse(restoredTriggerWindow, trigger!);
    expect(triggerResult.ok, triggerResult.error).toBe(true);
    expect(triggerResult.state.pendingTriggers).toEqual([]);
    expect(triggerResult.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(triggerResult.state.log.some((entry) => entry.detail === "Restored Ritual success watcher resolved")).toBe(true);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restoredTriggerWindow, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerWindow, triggerResult.state.waitingFor!));
    assertRestoreLegalWindow(restoredTriggerWindow, triggerResult, triggerResult.state.waitingFor!);
    expectStaleRestoredResponseRejected(restoredTriggerWindow, trigger!);
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
