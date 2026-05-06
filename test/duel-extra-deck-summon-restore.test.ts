import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("extra deck summon restore", () => {
  it("restores Fusion Summon legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    expect(fusion).toBeTruthy();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action?.type).toBe("fusionSummon");
    if (!action || action.type !== "fusionSummon") throw new Error("Expected restored Fusion Summon action");

    const result = applyResponse(restored, action);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expectStaleRestoredResponseRejected(restored, action);
  });

  it("restores Synchro Summon legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["910"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const synchro = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "910");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(synchro).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid);
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected restored Synchro Summon action");

    const result = applyResponse(restored, action);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === synchro!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expectStaleRestoredResponseRejected(restored, action);
  });

  it("restores Xyz Summon legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["920"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid);
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected restored Xyz Summon action");

    const result = applyResponse(restored, action);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === xyz!.uid)).toMatchObject({ location: "monsterZone", overlayCount: 2, faceUp: true });
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "overlay")).toBe(true);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expectStaleRestoredResponseRejected(restored, action);
  });

  it("restores Link Summon legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["930"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const link = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "930");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(link).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected restored Link Summon action");

    const result = applyResponse(restored, action);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === link!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expectStaleRestoredResponseRejected(restored, action);
  });
});

function expectStaleRestoredResponseRejected(restored: ReturnType<typeof restoreDuel>, action: NonNullable<Parameters<typeof applyResponse>[1]>): void {
  const staleResult = applyResponse(restored, action);
  expect(staleResult.ok).toBe(false);
  expect(staleResult.error).toContain("Response is not currently legal");
  expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
  expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, staleResult.state.waitingFor!));
  expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, staleResult.state.waitingFor!));
  expect(staleResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleResult.legalActions);
}

function assertRestoredFullZoneExtraDeckSummon(type: "fusionSummon" | "synchroSummon" | "xyzSummon" | "linkSummon", code: string, materialLocation: "graveyard" | "overlay"): void {
  const session = createDuel({ seed: 1, startingHandSize: 7, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100", "300", "500", "500", "500", "500", "500"], extra: [code] },
    1: { main: ["400", "400", "400", "400", "400", "400", "400"] },
  });
  startDuel(session);

  const allMonsters = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster");
  expect(allMonsters).toHaveLength(7);
  for (const monster of allMonsters.slice(0, 5)) moveDuelCard(session.state, monster.uid, "monsterZone", 0);

  const target = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === code);
  const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "monsterZone" && (card.code === "100" || card.code === "300"));
  expect(target).toBeTruthy();
  expect(materials).toHaveLength(2);

  const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
  expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
  const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === type && candidate.uid === target!.uid);
  expect(action).toMatchObject({ type, materialUids: materials.map((card) => card.uid) });
  if (!action || action.type !== type) throw new Error(`Expected restored full-zone ${type} action`);
  const restoredWindowId = queryPublicState(restored).actionWindowId;
  expect(action).toMatchObject({ windowId: restoredWindowId, windowKind: "open" });

  const staleBeforeSummon = applyResponse(restored, { ...action, windowId: restoredWindowId - 1 });
  expect(staleBeforeSummon.ok).toBe(false);
  expect(staleBeforeSummon.error).toContain("Response is not currently legal");
  expect(staleBeforeSummon.state.actionWindowId).toBe(restoredWindowId);
  expect(staleBeforeSummon.legalActions).toEqual(getDuelLegalActions(restored, 0));
  expect(staleBeforeSummon.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
  expect(staleBeforeSummon.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeSummon.legalActions);
  expect(restored.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "extraDeck" });
  expect(materials.every((material) => restored.state.cards.find((card) => card.uid === material.uid)?.location === "monsterZone")).toBe(true);

  const result = applyResponse(restored, action);
  expect(result.ok).toBe(true);
  expect(result.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
  expect(materials.every((material) => result.state.cards.find((card) => card.uid === material.uid)?.location === materialLocation)).toBe(true);
  expect(result.state.waitingFor).toBeDefined();
  expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  const staleResult = applyResponse(restored, action);
  expect(staleResult.ok).toBe(false);
  expect(staleResult.error).toContain("Response is not currently legal");
  expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
  expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, staleResult.state.waitingFor!));
  expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, staleResult.state.waitingFor!));
  expect(staleResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleResult.legalActions);
}

describe("full-zone extra deck summon restore", () => {
  it("restores full-zone Fusion Summon actions that free space with selected materials", () => {
    assertRestoredFullZoneExtraDeckSummon("fusionSummon", "900", "graveyard");
  });

  it("restores full-zone Synchro Summon actions that free space with selected materials", () => {
    assertRestoredFullZoneExtraDeckSummon("synchroSummon", "910", "graveyard");
  });

  it("restores full-zone Xyz Summon actions that free space with selected materials", () => {
    assertRestoredFullZoneExtraDeckSummon("xyzSummon", "920", "overlay");
  });

  it("restores full-zone Link Summon actions that free space with selected materials", () => {
    assertRestoredFullZoneExtraDeckSummon("linkSummon", "930", "graveyard");
  });
});
