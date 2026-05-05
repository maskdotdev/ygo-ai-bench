import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  restoreDuel,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards, findPublicCard, setupFailedMoveAfterFirstFixture } from "./full-duel-engine-fixtures.js";

describe("summon rollback responses", () => {
  it("rolls back failed fusion summon material moves from responses", () => {
    const { session, target: fusion, first: firstMaterial, blocked: blockedMaterial } = setupFailedMoveAfterFirstFixture({
      seed: 88,
      main: ["100", "300"],
      extra: ["900"],
      target: { location: "extraDeck", code: "900" },
      first: { location: "hand", code: "100" },
      blocked: { location: "hand", code: "300" },
      block: { id: "cannot-send-second-material", code: 68, range: ["hand"], firstMovedTo: "graveyard" },
    });
    expect(fusion).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("fusionSummon");
    if (!action || action.type !== "fusionSummon") throw new Error("Expected fusion summon action");
    const restoredWindowId = queryPublicState(session).actionWindowId;
    expect(action).toMatchObject({ windowId: restoredWindowId, windowKind: "open" });
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot move to graveyard");
    expect(session.state.actionWindowId).toBe(restoredWindowId);
    expect(result.state.actionWindowId).toBe(restoredWindowId);
    expect(result.state.windowKind).toBe("open");
    for (const legalAction of result.legalActions) expect(legalAction).toMatchObject({ windowId: restoredWindowId, windowKind: "open" });
    expect(session.state.cards.find((card) => card.uid === fusion!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("hand");
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(session.state.log.some((entry) => entry.action === "fusionMaterial")).toBe(false);
  });

  it("rolls back failed fusion summon responses after restoring a snapshot", () => {
    const original = createDuel({ seed: 94, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(original, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400", "400"] },
    });
    startDuel(original);
    const session = restoreDuel(serializeDuel(original), createCardReader(cards));

    const fusion = findPublicCard(session, 0, "extraDeck", "900");
    const firstMaterial = findPublicCard(session, 0, "hand", "100");
    const blockedMaterial = findPublicCard(session, 0, "hand", "300");
    expect(fusion).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    registerEffect(session, {
      id: "restored-cannot-send-second-material",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 68,
      range: ["hand"],
      canActivate(ctx) {
        return ctx.duel.cards.find((card) => card.uid === firstMaterial!.uid)?.location === "graveyard";
      },
      operation() {},
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("fusionSummon");
    if (!action || action.type !== "fusionSummon") throw new Error("Expected fusion summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === fusion!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("hand");
    expect(session.state.log.some((entry) => entry.action === "fusionMaterial")).toBe(false);
  });

  it("rolls back failed synchro summon material moves from responses", () => {
    const { session, target: synchro, first: firstMaterial, blocked: blockedMaterial } = setupFailedMoveAfterFirstFixture({
      seed: 89,
      main: ["100", "300"],
      extra: ["910"],
      target: { location: "extraDeck", code: "910" },
      first: { location: "hand", code: "100", moveTo: "monsterZone" },
      blocked: { location: "hand", code: "300", moveTo: "monsterZone" },
      block: { id: "cannot-send-second-synchro-material", code: 68, range: ["monsterZone"], firstMovedTo: "graveyard" },
    });
    expect(synchro).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected synchro summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("monsterZone");
    expect(session.state.log.some((entry) => entry.action === "synchroMaterial")).toBe(false);
  });

  it("rolls back failed Xyz summon material moves from responses", () => {
    const { session, target: xyz, first: firstMaterial, blocked: blockedMaterial } = setupFailedMoveAfterFirstFixture({
      seed: 90,
      main: ["100", "300"],
      extra: ["920"],
      target: { location: "extraDeck", code: "920" },
      first: { location: "hand", code: "100", moveTo: "monsterZone" },
      blocked: { location: "hand", code: "300", moveTo: "monsterZone" },
      block: { id: "cannot-overlay-second-material", code: 238, range: ["monsterZone"], firstMovedTo: "overlay" },
    });
    expect(xyz).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot be used as Xyz material");
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toEqual([]);
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("monsterZone");
    expect(session.state.log.some((entry) => entry.action === "xyzMaterial")).toBe(false);
  });

  it("rolls back failed link summon material moves from responses", () => {
    const { session, target: link, first: firstMaterial, blocked: blockedMaterial } = setupFailedMoveAfterFirstFixture({
      seed: 91,
      main: ["100", "300"],
      extra: ["930"],
      target: { location: "extraDeck", code: "930" },
      first: { location: "hand", code: "100", moveTo: "monsterZone" },
      blocked: { location: "hand", code: "300", moveTo: "monsterZone" },
      block: { id: "cannot-send-second-link-material", code: 68, range: ["monsterZone"], firstMovedTo: "graveyard" },
    });
    expect(link).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === link!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("monsterZone");
    expect(session.state.log.some((entry) => entry.action === "linkMaterial")).toBe(false);
  });

  it("rolls back failed ritual summon material moves from responses", () => {
    const { session, target: ritual, first: firstMaterial, blocked: blockedMaterial } = setupFailedMoveAfterFirstFixture({
      seed: 92,
      main: ["940", "100", "300"],
      target: { location: "hand", code: "940" },
      first: { location: "hand", code: "100" },
      blocked: { location: "hand", code: "300" },
      block: { id: "cannot-send-second-ritual-material", code: 68, range: ["hand"], firstMovedTo: "graveyard" },
    });
    expect(ritual).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "ritualSummon" && candidate.uid === ritual!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("ritualSummon");
    if (!action || action.type !== "ritualSummon") throw new Error("Expected ritual summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === ritual!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("hand");
    expect(session.state.log.some((entry) => entry.action === "ritualMaterial")).toBe(false);
  });

  it("rolls back failed tribute summon release moves from responses", () => {
    const { session, target: tributeMonster, first: firstTribute, blocked: blockedTribute } = setupFailedMoveAfterFirstFixture({
      seed: 93,
      main: ["700", "100", "300"],
      target: { location: "hand", code: "700" },
      first: { location: "hand", code: "100", moveTo: "monsterZone" },
      blocked: { location: "hand", code: "300", moveTo: "monsterZone" },
      block: { id: "cannot-send-second-tribute", code: 68, range: ["monsterZone"], firstMovedTo: "graveyard" },
    });
    expect(tributeMonster).toBeTruthy();
    expect(firstTribute).toBeTruthy();
    expect(blockedTribute).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "tributeSummon" && candidate.uid === tributeMonster!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("tributeSummon");
    if (!action || action.type !== "tributeSummon") throw new Error("Expected tribute summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === firstTribute!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === blockedTribute!.uid)?.location).toBe("monsterZone");
    expect(session.state.log.some((entry) => entry.action === "release")).toBe(false);
  });
});
