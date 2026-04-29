import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  detachDuelOverlayMaterials,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  startDuel,
  xyzSummonDuelCard,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel xyz summons", () => {
  it("xyz summons from the extra deck using field materials as overlays", () => {
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

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === xyz!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === xyz!.uid)?.overlayCount).toBe(2);
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "overlay")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "xyzSummon" && entry.card === "Xyz Test Monster")).toBe(true);
  });

  it("blocks Xyz summons when material cannot be used as Xyz material", () => {
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
    const blockedMaterial = materials.find((card) => card.code === "100");
    expect(blockedMaterial).toBeTruthy();

    registerEffect(session, {
      id: "cannot-be-xyz-material",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 238,
      range: ["monsterZone"],
      operation() {},
    });

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid)).toBe(false);
    expect(() => xyzSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid))).toThrow("cannot be used as Xyz material");
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("monsterZone");
  });

  it("matches explicit Xyz materials through card aliases", () => {
    const session = createDuel({
      seed: 1,
      startingHandSize: 2,
      cardReader: createCardReader([
        { code: "100", alias: "101", name: "Aliased Xyz Material", kind: "monster", level: 4 },
        { code: "300", alias: "301", name: "Second Aliased Xyz Material", kind: "monster", level: 4 },
        { code: "920", name: "Alias Xyz", kind: "extra", xyzMaterials: ["101", "301"] },
      ]),
    });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["920"] },
      1: { main: ["300", "300"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    const firstMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const secondMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(xyz).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(secondMaterial).toBeTruthy();
    moveDuelCard(session.state, firstMaterial!.uid, "monsterZone", 0);
    moveDuelCard(session.state, secondMaterial!.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid);
    expect(action).toBeTruthy();
    expect(action).toMatchObject({ materialUids: [firstMaterial!.uid, secondMaterial!.uid] });

    xyzSummonDuelCard(session.state, 0, xyz!.uid, [firstMaterial!.uid, secondMaterial!.uid]);

    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toEqual([firstMaterial!.uid, secondMaterial!.uid]);
  });

  it("xyz summons emit special summon triggers without sending materials to the graveyard", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"], extra: ["920"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(triggerSource).toBeTruthy();
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    registerEffect(session, {
      id: "xyz-special-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Xyz special summoned ${ctx.eventCard?.name}`);
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid);
    expect(action).toBeTruthy();
    const summonResult = applyResponse(session, action!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.cards.filter((card) => action && action.type === "xyzSummon" && action.materialUids.includes(card.uid) && card.location === "graveyard")).toHaveLength(0);
    expect(summonResult.state.pendingTriggers).toHaveLength(1);
    expect(summonResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: xyz!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "xyz-special-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Xyz special summoned Xyz Test Monster")).toBe(true);
  });

  it("xyz summons generic monsters with two matching-level materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["310", "330"], extra: ["980"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "310" || card.code === "330"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("xyzSummon");
    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === xyz!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === xyz!.uid)?.overlayCount).toBe(2);
    expect(action.materialUids.every((materialUid) => result.state.cards.find((card) => card.uid === materialUid)?.location === "overlay")).toBe(true);
  });

  it("detaches Xyz overlay materials to the graveyard", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["310", "330"], extra: ["980"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "310" || card.code === "330"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    xyzSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid));
    const firstOverlayUid = session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids[0];
    const firstOverlayCode = session.state.cards.find((card) => card.uid === firstOverlayUid)?.code;

    const detached = detachDuelOverlayMaterials(session.state, xyz!.uid, 1, 0);
    expect(detached.map((card) => card.code)).toEqual([firstOverlayCode]);
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)?.overlayUids).toHaveLength(1);
    expect(session.state.cards.find((card) => card.uid === detached[0]!.uid)?.location).toBe("graveyard");
    expect(() => detachDuelOverlayMaterials(session.state, xyz!.uid, 2, 0)).toThrow("does not have enough overlay materials");
  });

  it("rejects generic xyz materials with mismatched levels", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["310", "320"], extra: ["980"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "310" || card.code === "320"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid)).toBe(false);
    expect(() => xyzSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid))).toThrow("Xyz materials are not legal");
  });

  it("rejects generic xyz summons without exactly two materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["310", "330", "310"], extra: ["980"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "310" || card.code === "330"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(3);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "xyzSummon" && candidate.uid === xyz!.uid);
    expect(action).toBeTruthy();
    expect(action).toMatchObject({ type: "xyzSummon", materialUids: [materials[0]!.uid, materials[1]!.uid] });
    expect(() => xyzSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid))).toThrow("Xyz materials are not legal");
  });

  it("does not expose xyz summon actions without field materials or with no monster zone space", () => {
    const handOnly = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(handOnly, {
      0: { main: ["100", "300"], extra: ["920"] },
      1: { main: ["400", "400"] },
    });
    startDuel(handOnly);
    expect(getDuelLegalActions(handOnly, 0).some((candidate) => candidate.type === "xyzSummon")).toBe(false);

    const missing = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(missing, {
      0: { main: ["100"], extra: ["920"] },
      1: { main: ["400"] },
    });
    startDuel(missing);
    const material = queryPublicState(missing).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(material).toBeTruthy();
    moveDuelCard(missing.state, material!.uid, "monsterZone", 0);
    expect(getDuelLegalActions(missing, 0).some((candidate) => candidate.type === "xyzSummon")).toBe(false);

    const full = createDuel({ seed: 1, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(full, {
      0: { main: ["100", "300", "500", "500", "500", "500", "500"], extra: ["920"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(full);
    const allMonsters = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster");
    expect(allMonsters).toHaveLength(7);
    for (const monster of allMonsters.slice(0, 5)) moveDuelCard(full.state, monster.uid, "monsterZone", 0);
    expect(getDuelLegalActions(full, 0).some((candidate) => candidate.type === "xyzSummon")).toBe(false);

    const xyz = queryPublicState(full).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    const materials = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "monsterZone" && (card.code === "100" || card.code === "300"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(() => xyzSummonDuelCard(full.state, 0, xyz!.uid, materials.map((card) => card.uid))).toThrow("monsterZone is full");
  });
});
