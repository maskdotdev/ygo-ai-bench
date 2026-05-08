import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  fusionSummonDuelCard,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel fusion summons", () => {
  it("fusion summons from the extra deck using hand materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    expect(fusion).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("fusionSummon");
    if (!action || action.type !== "fusionSummon") throw new Error("Expected fusion summon action");
    const result = applyAndAssert(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === fusion!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === fusion!.uid)?.position).toBe("faceUpAttack");
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "fusionSummon" && entry.card === "Fusion Test Monster")).toBe(true);
  });

  it("fusion summons using mixed hand and field materials and emits special summon triggers", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"], extra: ["900"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const fieldMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(fieldMaterial).toBeTruthy();
    expect(fusion).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    moveDuelCard(session.state, fieldMaterial!.uid, "monsterZone", 0);
    registerEffect(session, {
      id: "fusion-special-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Fusion special summoned ${ctx.eventCard?.name}`);
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeTruthy();
    const fusionResult = applyAndAssert(session, action!);

    expect(fusionResult.ok).toBe(true);
    expect(fusionResult.state.cards.find((card) => card.uid === fieldMaterial!.uid)?.location).toBe("graveyard");
    expect(fusionResult.state.pendingTriggers).toHaveLength(1);
    expect(fusionResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: fusion!.uid });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "fusion-special-trigger");
    expect(trigger).toBeTruthy();
    const result = applyAndAssert(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Fusion special summoned Fusion Test Monster")).toBe(true);
  });

  it("queues material triggers when fusion materials are consumed", () => {
    const session = createDuel({ seed: 21, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const material = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    expect(material).toBeTruthy();
    expect(fusion).toBeTruthy();
    registerEffect(session, {
      id: "fusion-material-used-trigger",
      sourceUid: material!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "usedAsMaterial",
      triggerSourceOnly: true,
      range: ["graveyard"],
      operation(ctx) {
        ctx.log(`Fusion material used ${ctx.eventCard?.code ?? ""}`);
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeTruthy();
    const result = applyAndAssert(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "usedAsMaterial", eventCardUid: material!.uid }));
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "fusion-material-used-trigger");
    expect(trigger).toBeTruthy();
    applyAndAssert(session, trigger!);
    expect(session.state.log.some((entry) => entry.detail === "Fusion material used 100")).toBe(true);
  });

  it("queues pre-material triggers before fusion materials leave their original location", () => {
    const session = createDuel({ seed: 22, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const material = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    expect(material).toBeTruthy();
    expect(fusion).toBeTruthy();
    registerEffect(session, {
      id: "fusion-pre-material-trigger",
      sourceUid: material!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "preUsedAsMaterial",
      triggerSourceOnly: true,
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Fusion material pre-used ${ctx.eventCard?.code ?? ""}`);
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeTruthy();
    const result = applyAndAssert(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === material!.uid)?.location).toBe("graveyard");
    expect(result.state.pendingTriggers).toContainEqual(expect.objectContaining({ eventName: "preUsedAsMaterial", eventCardUid: material!.uid }));
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "fusion-pre-material-trigger");
    expect(trigger).toBeTruthy();
    applyAndAssert(session, trigger!);
    expect(session.state.log.some((entry) => entry.detail === "Fusion material pre-used 100")).toBe(true);
  });

  it("matches explicit fusion materials through card aliases", () => {
    const session = createDuel({
      seed: 1,
      startingHandSize: 2,
      cardReader: createCardReader([
        { code: "100", alias: "101", name: "Aliased Material", kind: "monster" },
        { code: "300", name: "Second Material", kind: "monster" },
        { code: "900", name: "Alias Fusion", kind: "extra", fusionMaterials: ["101", "300"] },
      ]),
    });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["300", "300"] },
    });
    startDuel(session);

    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    const aliasMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const otherMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(fusion).toBeTruthy();
    expect(aliasMaterial).toBeTruthy();
    expect(otherMaterial).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toBeTruthy();
    expect(action).toMatchObject({ materialUids: [aliasMaterial!.uid, otherMaterial!.uid] });

    fusionSummonDuelCard(session.state, 0, fusion!.uid, [aliasMaterial!.uid, otherMaterial!.uid]);

    expect(session.state.cards.find((card) => card.uid === fusion!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === aliasMaterial!.uid)?.location).toBe("graveyard");
    expect(session.state.cards.find((card) => card.uid === otherMaterial!.uid)?.location).toBe("graveyard");
  });

  it("exposes each explicit Fusion material combination when multiple matching copies are legal", () => {
    const session = createDuel({
      seed: 1,
      startingHandSize: 3,
      cardReader: createCardReader([
        { code: "100", name: "First Fusion Material Copy", kind: "monster" },
        { code: "300", name: "Second Fusion Material", kind: "monster" },
        { code: "900", name: "Two-Copy Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
      ]),
    });
    loadDecks(session, {
      0: { main: ["100", "100", "300"], extra: ["900"] },
      1: { main: ["300", "300", "300"] },
    });
    startDuel(session);

    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    const codeAMaterials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const codeB = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(fusion).toBeTruthy();
    expect(codeAMaterials).toHaveLength(2);
    expect(codeB).toBeTruthy();
    const fieldCodeA = codeAMaterials[0]!;
    const handCodeA = codeAMaterials[1]!;
    moveDuelCard(session.state, fieldCodeA.uid, "monsterZone", 0);

    const actions = getDuelLegalActions(session, 0).filter((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(actions).toHaveLength(2);
    const materialUidSets = actions.map((action) => {
      if (action.type !== "fusionSummon") throw new Error("Expected Fusion Summon action");
      return action.materialUids;
    });
    expect(materialUidSets).toEqual(expect.arrayContaining([[handCodeA.uid, codeB!.uid], [fieldCodeA.uid, codeB!.uid]]));

    const fieldMaterialAction = actions.find((action) => action.type === "fusionSummon" && action.materialUids.includes(fieldCodeA.uid));
    expect(fieldMaterialAction).toBeTruthy();
    const result = applyAndAssert(session, fieldMaterialAction!);

    expect(result.state.cards.find((card) => card.uid === fusion!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === fieldCodeA.uid)?.location).toBe("graveyard");
    expect(result.state.cards.find((card) => card.uid === handCodeA.uid)?.location).toBe("hand");
    expect(result.state.cards.find((card) => card.uid === codeB!.uid)?.location).toBe("graveyard");
  });

  it("applies graveyard redirects to fusion materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    const redirectedMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const otherMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(fusion).toBeTruthy();
    expect(redirectedMaterial).toBeTruthy();
    expect(otherMaterial).toBeTruthy();

    registerEffect(session, {
      id: "fusion-material-grave-redirect",
      sourceUid: redirectedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 63,
      range: ["hand"],
      operation() {},
    });

    fusionSummonDuelCard(session.state, 0, fusion!.uid, [redirectedMaterial!.uid, otherMaterial!.uid]);

    const redirected = session.state.cards.find((card) => card.uid === redirectedMaterial!.uid);
    expect(redirected?.location).toBe("banished");
    expect(redirected?.reason && (redirected.reason & duelReason.fusion)).toBe(duelReason.fusion);
    expect(redirected?.reason && (redirected.reason & duelReason.redirect)).toBe(duelReason.redirect);
    expect(session.state.cards.find((card) => card.uid === otherMaterial!.uid)?.location).toBe("graveyard");
    expect(session.state.cards.find((card) => card.uid === fusion!.uid)?.location).toBe("monsterZone");
  });

  it("blocks fusion summons when material cannot be used as Fusion material", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    const blockedMaterial = materials.find((card) => card.code === "100");
    expect(fusion).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(blockedMaterial).toBeTruthy();

    registerEffect(session, {
      id: "cannot-be-fusion-material",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 235,
      range: ["hand"],
      operation() {},
    });

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid)).toBe(false);
    expect(() => fusionSummonDuelCard(session.state, 0, fusion!.uid, materials.map((card) => card.uid))).toThrow("cannot be used as fusion material");
    expect(session.state.cards.find((card) => card.uid === fusion!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("hand");
  });

  it("rejects matching-code non-monsters as direct fusion materials", () => {
    const session = createDuel({
      seed: 1,
      startingHandSize: 2,
      cardReader: createCardReader([
        { code: "100", name: "Material Spell", kind: "spell" },
        { code: "300", name: "Real Material", kind: "monster" },
        { code: "900", name: "Spell-Proof Fusion", kind: "extra", fusionMaterials: ["100", "300"] },
      ]),
    });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["300", "300"] },
    });
    startDuel(session);

    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    const spell = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(fusion).toBeTruthy();
    expect(spell).toBeTruthy();
    expect(monster).toBeTruthy();

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid)).toBe(false);
    expect(() => fusionSummonDuelCard(session.state, 0, fusion!.uid, [spell!.uid, monster!.uid])).toThrow("cannot be used as fusion material");
    expect(session.state.cards.find((card) => card.uid === fusion!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === spell!.uid)?.location).toBe("hand");
  });

  it("rejects non-monsters as fusion summon targets", () => {
    const session = createDuel({
      seed: 1,
      startingHandSize: 2,
      cardReader: createCardReader([
        { code: "100", name: "First Material", kind: "monster" },
        { code: "300", name: "Second Material", kind: "monster" },
        { code: "900", name: "Impossible Fusion Spell", kind: "spell", fusionMaterials: ["100", "300"] },
      ]),
    });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["300", "300"] },
    });
    startDuel(session);

    const target = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(target).toBeTruthy();
    expect(materials).toHaveLength(2);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "fusionSummon" && candidate.uid === target!.uid)).toBe(false);
    expect(() => fusionSummonDuelCard(session.state, 0, target!.uid, materials.map((card) => card.uid))).toThrow("is not a fusion monster");
    expect(session.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("extraDeck");
  });

  it("does not expose fusion summon actions without all materials or with no monster zone space", () => {
    const missing = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(missing, {
      0: { main: ["100"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(missing);
    expect(getDuelLegalActions(missing, 0).some((candidate) => candidate.type === "fusionSummon")).toBe(false);

    const full = createDuel({ seed: 1, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(full, {
      0: { main: ["100", "300", "500", "500", "500", "500", "500"], extra: ["900"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(full);
    const blockers = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster" && card.code === "500");
    expect(blockers).toHaveLength(5);
    for (const blocker of blockers) moveDuelCard(full.state, blocker.uid, "monsterZone", 0);
    expect(getDuelLegalActions(full, 0).some((candidate) => candidate.type === "fusionSummon")).toBe(false);

    const fusion = queryPublicState(full).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    const materials = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(fusion).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(() => fusionSummonDuelCard(full.state, 0, fusion!.uid, materials.map((card) => card.uid))).toThrow("monsterZone is full");
  });

  it("counts selected field fusion materials as freeing zone space", () => {
    const session = createDuel({ seed: 1, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500", "500", "500", "500", "500"], extra: ["900"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(session);
    const firstMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const blockers = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster" && card.code === "500");
    expect(firstMaterial).toBeTruthy();
    expect(blockers).toHaveLength(5);
    moveDuelCard(session.state, firstMaterial!.uid, "monsterZone", 0);
    for (const blocker of blockers.slice(0, 4)) moveDuelCard(session.state, blocker.uid, "monsterZone", 0);

    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    const secondMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(fusion).toBeTruthy();
    expect(secondMaterial).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid);
    expect(action).toMatchObject({ type: "fusionSummon", materialUids: [firstMaterial!.uid, secondMaterial!.uid] });

    fusionSummonDuelCard(session.state, 0, fusion!.uid, [firstMaterial!.uid, secondMaterial!.uid]);

    expect(session.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("graveyard");
    expect(session.state.cards.find((card) => card.uid === secondMaterial!.uid)?.location).toBe("graveyard");
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
