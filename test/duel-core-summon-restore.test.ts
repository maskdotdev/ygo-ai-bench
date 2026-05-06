import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

function expectRestoredOpenAction(restored: ReturnType<typeof restoreDuel>, action: { windowId?: number; windowKind?: string } | undefined): void {
  expect(action).toBeDefined();
  expect(action).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "open" });
}

function expectStaleRestoredResponseRejected(restored: ReturnType<typeof restoreDuel>, action: NonNullable<Parameters<typeof applyResponse>[1]>): void {
  const staleResult = applyResponse(restored, action);
  expect(staleResult.ok).toBe(false);
  expect(staleResult.error).toContain("Response is not currently legal");
  expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
  expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, staleResult.state.waitingFor!));
  expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, staleResult.state.waitingFor!));
  expect(staleResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleResult.legalActions);
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
    expect(staleBeforeSummon.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeSummon.legalActions);
    expect(restored.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "hand" });
    expect(restored.state.players[0].normalSummonAvailable).toBe(true);

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(result.state.players[0].normalSummonAvailable).toBe(false);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
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
    expect(staleBeforeSummon.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeSummon.legalActions);
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
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
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
    expect(staleBeforeSummon.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeSummon.legalActions);
    expect(restored.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack", faceUp: true });
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expectStaleRestoredResponseRejected(restored, action!);
  });

  it("restores Ritual Summon legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const ritual = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    expect(ritual).toBeTruthy();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
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
    expect(staleBeforeSummon.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeSummon.legalActions);
    expect(restored.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({ location: "hand" });
    expect(action.materialUids.every((uid) => restored.state.cards.find((card) => card.uid === uid)?.location === "hand")).toBe(true);

    const result = applyResponse(restored, action);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expectStaleRestoredResponseRejected(restored, action);
  });
});
