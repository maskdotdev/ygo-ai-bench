import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  startDuel,
  synchroSummonDuelCard,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel synchro summons", () => {
  it("synchro summons from the extra deck using field materials", () => {
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

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected synchro summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === synchro!.uid)?.location).toBe("monsterZone");
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "synchroSummon" && entry.card === "Synchro Test Monster")).toBe(true);
  });

  it("blocks synchro summons when material cannot be sent to the graveyard", () => {
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
    const blockedMaterial = materials.find((card) => card.code === "100");
    expect(blockedMaterial).toBeTruthy();

    registerEffect(session, {
      id: "synchro-material-grave-block",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 68,
      range: ["monsterZone"],
      operation() {},
    });

    expect(() => synchroSummonDuelCard(session.state, 0, synchro!.uid, materials.map((card) => card.uid))).toThrow("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("monsterZone");
  });

  it("matches explicit synchro materials through card aliases", () => {
    const session = createDuel({
      seed: 1,
      startingHandSize: 2,
      cardReader: createCardReader([
        { code: "100", alias: "101", name: "Aliased Tuner", kind: "monster", typeFlags: 0x1001 },
        { code: "300", alias: "301", name: "Aliased Non-Tuner", kind: "monster" },
        { code: "910", name: "Alias Synchro", kind: "extra", synchroMaterials: { tuner: "101", nonTuners: ["301"] } },
      ]),
    });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["910"] },
      1: { main: ["300", "300"] },
    });
    startDuel(session);

    const synchro = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "910");
    const aliasTuner = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const aliasNonTuner = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(synchro).toBeTruthy();
    expect(aliasTuner).toBeTruthy();
    expect(aliasNonTuner).toBeTruthy();
    moveDuelCard(session.state, aliasTuner!.uid, "monsterZone", 0);
    moveDuelCard(session.state, aliasNonTuner!.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid);
    expect(action).toBeTruthy();
    expect(action).toMatchObject({ materialUids: [aliasTuner!.uid, aliasNonTuner!.uid] });

    synchroSummonDuelCard(session.state, 0, synchro!.uid, [aliasTuner!.uid, aliasNonTuner!.uid]);

    expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === aliasTuner!.uid)?.location).toBe("graveyard");
    expect(session.state.cards.find((card) => card.uid === aliasNonTuner!.uid)?.location).toBe("graveyard");
  });

  it("blocks synchro summons when material cannot be used as Synchro material", () => {
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
    const blockedMaterial = materials.find((card) => card.code === "100");
    expect(blockedMaterial).toBeTruthy();

    registerEffect(session, {
      id: "cannot-be-synchro-material",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 236,
      range: ["monsterZone"],
      operation() {},
    });

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid)).toBe(false);
    expect(() => synchroSummonDuelCard(session.state, 0, synchro!.uid, materials.map((card) => card.uid))).toThrow("cannot be used as synchro material");
    expect(session.state.cards.find((card) => card.uid === synchro!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("monsterZone");
  });

  it("synchro summons emit special summon triggers", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"], extra: ["910"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const synchro = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "910");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(synchro).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(triggerSource).toBeTruthy();
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    registerEffect(session, {
      id: "synchro-special-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Synchro special summoned ${ctx.eventCard?.name}`);
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid);
    expect(action).toBeTruthy();
    const summonResult = applyResponse(session, action!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.pendingTriggers).toHaveLength(1);
    expect(summonResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: synchro!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "synchro-special-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Synchro special summoned Synchro Test Monster")).toBe(true);
  });

  it("synchro summons generic monsters with one tuner and matching levels", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["110", "310"], extra: ["970"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const synchro = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "970");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "110" || card.code === "310"));
    expect(synchro).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("synchroSummon");
    if (!action || action.type !== "synchroSummon") throw new Error("Expected synchro summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === synchro!.uid)?.location).toBe("monsterZone");
    expect(action.materialUids.every((materialUid) => result.state.cards.find((card) => card.uid === materialUid)?.location === "graveyard")).toBe(true);
  });

  it("rejects generic synchro materials with the wrong level total", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["110", "320"], extra: ["970"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const synchro = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "970");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "110" || card.code === "320"));
    expect(synchro).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid)).toBe(false);
    expect(() => synchroSummonDuelCard(session.state, 0, synchro!.uid, materials.map((card) => card.uid))).toThrow("synchro materials are not legal");
  });

  it("rejects generic synchro materials without exactly one tuner", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["310", "320"], extra: ["970"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const synchro = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "970");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "310" || card.code === "320"));
    expect(synchro).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "synchroSummon" && candidate.uid === synchro!.uid)).toBe(false);
    expect(() => synchroSummonDuelCard(session.state, 0, synchro!.uid, materials.map((card) => card.uid))).toThrow("synchro materials are not legal");
  });

  it("does not treat non-synchro extra deck ranks as generic synchro targets", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["110", "340"], extra: ["980"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const xyz = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "980");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "110" || card.code === "340"));
    expect(xyz).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "synchroSummon" && candidate.uid === xyz!.uid)).toBe(false);
    expect(() => synchroSummonDuelCard(session.state, 0, xyz!.uid, materials.map((card) => card.uid))).toThrow("synchro materials are not legal");
  });

  it("does not expose synchro summon actions without field materials or with no monster zone space", () => {
    const handOnly = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(handOnly, {
      0: { main: ["100", "300"], extra: ["910"] },
      1: { main: ["400", "400"] },
    });
    startDuel(handOnly);
    expect(getDuelLegalActions(handOnly, 0).some((candidate) => candidate.type === "synchroSummon")).toBe(false);

    const missing = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(missing, {
      0: { main: ["100"], extra: ["910"] },
      1: { main: ["400"] },
    });
    startDuel(missing);
    const tuner = queryPublicState(missing).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tuner).toBeTruthy();
    moveDuelCard(missing.state, tuner!.uid, "monsterZone", 0);
    expect(getDuelLegalActions(missing, 0).some((candidate) => candidate.type === "synchroSummon")).toBe(false);

    const full = createDuel({ seed: 1, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(full, {
      0: { main: ["100", "300", "500", "500", "500", "500", "500"], extra: ["910"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(full);
    const allMonsters = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster");
    expect(allMonsters).toHaveLength(7);
    for (const monster of allMonsters.slice(0, 5)) moveDuelCard(full.state, monster.uid, "monsterZone", 0);
    expect(getDuelLegalActions(full, 0).some((candidate) => candidate.type === "synchroSummon")).toBe(false);

    const synchro = queryPublicState(full).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "910");
    const materials = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "monsterZone" && (card.code === "100" || card.code === "300"));
    expect(synchro).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(() => synchroSummonDuelCard(full.state, 0, synchro!.uid, materials.map((card) => card.uid))).toThrow("monsterZone is full");
  });
});
