import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
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
  });
});
