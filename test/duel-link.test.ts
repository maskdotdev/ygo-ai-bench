import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  linkSummonDuelCard,
  loadDecks,
  queryPublicState,
  registerEffect,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel link summons", () => {
  it("link summons from the extra deck using field materials", () => {
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

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("linkSummon");
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === link!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === link!.uid)?.position).toBe("faceUpAttack");
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "linkSummon" && entry.card === "Link Test Monster")).toBe(true);
  });

  it("applies graveyard redirects to link materials", () => {
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
    const redirectedMaterial = materials.find((card) => card.code === "100");
    expect(redirectedMaterial).toBeTruthy();

    registerEffect(session, {
      id: "link-material-grave-redirect",
      sourceUid: redirectedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 63,
      range: ["monsterZone"],
      operation() {},
    });

    linkSummonDuelCard(session.state, 0, link!.uid, materials.map((card) => card.uid));

    const redirected = session.state.cards.find((card) => card.uid === redirectedMaterial!.uid);
    expect(redirected?.location).toBe("banished");
    expect(redirected?.reason && (redirected.reason & duelReason.link)).toBe(duelReason.link);
    expect(redirected?.reason && (redirected.reason & duelReason.redirect)).toBe(duelReason.redirect);
    expect(session.state.cards.find((card) => card.uid === link!.uid)?.location).toBe("monsterZone");
  });

  it("blocks link summons when material cannot be used as material", () => {
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
    const blockedMaterial = materials.find((card) => card.code === "100");
    expect(blockedMaterial).toBeTruthy();

    registerEffect(session, {
      id: "cannot-be-material",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 248,
      range: ["monsterZone"],
      operation() {},
    });

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid)).toBe(false);
    expect(() => linkSummonDuelCard(session.state, 0, link!.uid, materials.map((card) => card.uid))).toThrow("cannot be used as Link material");
    expect(session.state.cards.find((card) => card.uid === link!.uid)?.location).toBe("extraDeck");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("monsterZone");
  });

  it("matches explicit Link materials through card aliases", () => {
    const session = createDuel({
      seed: 1,
      startingHandSize: 2,
      cardReader: createCardReader([
        { code: "100", alias: "101", name: "Aliased Link Material", kind: "monster" },
        { code: "300", alias: "301", name: "Second Aliased Link Material", kind: "monster" },
        { code: "930", name: "Alias Link", kind: "extra", typeFlags: 0x4000001, level: 2, linkMaterials: ["101", "301"] },
      ]),
    });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["930"] },
      1: { main: ["300", "300"] },
    });
    startDuel(session);

    const link = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "930");
    const firstMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const secondMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(link).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(secondMaterial).toBeTruthy();
    moveDuelCard(session.state, firstMaterial!.uid, "monsterZone", 0);
    moveDuelCard(session.state, secondMaterial!.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(action).toBeTruthy();
    expect(action).toMatchObject({ materialUids: [firstMaterial!.uid, secondMaterial!.uid] });

    linkSummonDuelCard(session.state, 0, link!.uid, [firstMaterial!.uid, secondMaterial!.uid]);

    expect(session.state.cards.find((card) => card.uid === link!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("graveyard");
    expect(session.state.cards.find((card) => card.uid === secondMaterial!.uid)?.location).toBe("graveyard");
  });

  it("finds later explicit Link material copies when their rating makes the summon legal", () => {
    const session = createDuel({
      seed: 1,
      startingHandSize: 3,
      cardReader: createCardReader([
        { code: "100", name: "First Code A Material", kind: "monster" },
        { code: "200", name: "Code B Material", kind: "monster" },
        { code: "300", alias: "100", name: "Link-2 Code A Material", kind: "extra", typeFlags: 0x4000001, level: 2 },
        { code: "930", name: "Explicit Link-3", kind: "extra", typeFlags: 0x4000001, level: 3, linkMaterials: ["100", "200"] },
      ]),
    });
    loadDecks(session, {
      0: { main: ["100", "300", "200"], extra: ["930"] },
      1: { main: ["200", "200", "200"] },
    });
    startDuel(session);

    const link = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "930");
    const firstCodeA = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const ratedCodeA = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const codeB = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(link).toBeTruthy();
    expect(firstCodeA).toBeTruthy();
    expect(ratedCodeA).toBeTruthy();
    expect(codeB).toBeTruthy();
    moveDuelCard(session.state, firstCodeA!.uid, "monsterZone", 0);
    moveDuelCard(session.state, ratedCodeA!.uid, "monsterZone", 0);
    moveDuelCard(session.state, codeB!.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(action).toBeTruthy();
    expect(action).toMatchObject({ materialUids: [ratedCodeA!.uid, codeB!.uid] });

    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === link!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === firstCodeA!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === ratedCodeA!.uid)?.location).toBe("graveyard");
    expect(result.state.cards.find((card) => card.uid === codeB!.uid)?.location).toBe("graveyard");
  });

  it("exposes each explicit Link material combination when multiple matching copies are legal", () => {
    const session = createDuel({
      seed: 1,
      startingHandSize: 3,
      cardReader: createCardReader([
        { code: "100", name: "First Link Material Copy", kind: "monster" },
        { code: "300", name: "Second Link Material", kind: "monster" },
        { code: "930", name: "Two-Copy Link", kind: "extra", typeFlags: 0x4000001, level: 2, linkMaterials: ["100", "300"] },
      ]),
    });
    loadDecks(session, {
      0: { main: ["100", "100", "300"], extra: ["930"] },
      1: { main: ["300", "300", "300"] },
    });
    startDuel(session);

    const link = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "930");
    const codeAMaterials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const codeB = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(link).toBeTruthy();
    expect(codeAMaterials).toHaveLength(2);
    expect(codeB).toBeTruthy();
    for (const material of [...codeAMaterials, codeB!]) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const actions = getDuelLegalActions(session, 0).filter((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(actions).toHaveLength(2);
    const materialUidSets = actions.map((action) => {
      if (action.type !== "linkSummon") throw new Error("Expected Link Summon action");
      return action.materialUids;
    });
    expect(materialUidSets).toEqual(expect.arrayContaining([[codeAMaterials[0]!.uid, codeB!.uid], [codeAMaterials[1]!.uid, codeB!.uid]]));

    const secondCopyAction = actions.find((action) => action.type === "linkSummon" && action.materialUids.includes(codeAMaterials[1]!.uid));
    expect(secondCopyAction).toBeTruthy();
    const result = applyResponse(session, secondCopyAction!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === link!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === codeAMaterials[0]!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === codeAMaterials[1]!.uid)?.location).toBe("graveyard");
    expect(result.state.cards.find((card) => card.uid === codeB!.uid)?.location).toBe("graveyard");
  });

  it("rejects non-monsters as Link summon targets", () => {
    const session = createDuel({
      seed: 1,
      startingHandSize: 2,
      cardReader: createCardReader([
        { code: "100", name: "First Link Material", kind: "monster" },
        { code: "300", name: "Second Link Material", kind: "monster" },
        { code: "930", name: "Impossible Link Spell", kind: "spell", typeFlags: 0x4000002, level: 2, linkMaterials: ["100", "300"] },
      ]),
    });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["930"] },
      1: { main: ["300", "300"] },
    });
    startDuel(session);

    const target = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "930");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(target).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "linkSummon" && candidate.uid === target!.uid)).toBe(false);
    expect(() => linkSummonDuelCard(session.state, 0, target!.uid, materials.map((card) => card.uid))).toThrow("is not a Link monster");
    expect(session.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("extraDeck");
  });

  it("link summons emit special summon triggers", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"], extra: ["930"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const link = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "930");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(link).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(triggerSource).toBeTruthy();
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    registerEffect(session, {
      id: "link-special-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Link special summoned ${ctx.eventCard?.name}`);
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(action).toBeTruthy();
    const summonResult = applyResponse(session, action!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.pendingTriggers).toHaveLength(1);
    expect(summonResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: link!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "link-special-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Link special summoned Link Test Monster")).toBe(true);
  });

  it("link summons generic links by material rating", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["950"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const link = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "950");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(link).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(action).toBeTruthy();
    if (!action || action.type !== "linkSummon") throw new Error("Expected Link summon action");
    expect(action.materialUids).toHaveLength(2);
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === link!.uid)?.location).toBe("monsterZone");
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
  });

  it("lets a link material contribute its link rating", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"], extra: ["950", "960"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const link2 = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "950");
    const link3 = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "960");
    const firstMaterials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(link2).toBeTruthy();
    expect(link3).toBeTruthy();
    for (const material of firstMaterials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    const link2Action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link2!.uid);
    expect(link2Action).toBeTruthy();
    expect(applyResponse(session, link2Action!).ok).toBe(true);

    const third = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(third).toBeTruthy();
    moveDuelCard(session.state, third!.uid, "monsterZone", 0);

    const link3Action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link3!.uid);
    expect(link3Action).toBeTruthy();
    if (!link3Action || link3Action.type !== "linkSummon") throw new Error("Expected Link-3 summon action");
    expect(link3Action.materialUids).toEqual(expect.arrayContaining([link2!.uid, third!.uid]));
    const result = applyResponse(session, link3Action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === link3!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === link2!.uid)?.location).toBe("graveyard");
  });

  it("rejects link summons with invalid material rating totals", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["960"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const link = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "960");
    const materials = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(link).toBeTruthy();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid)).toBe(false);
    expect(() => linkSummonDuelCard(session.state, 0, link!.uid, materials.map((material) => material.uid))).toThrow("Link materials are not legal");
  });

  it("does not expose link summon actions without field materials and counts selected materials as freeing zone space", () => {
    const handOnly = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(handOnly, {
      0: { main: ["100", "300"], extra: ["930"] },
      1: { main: ["400", "400"] },
    });
    startDuel(handOnly);
    expect(getDuelLegalActions(handOnly, 0).some((candidate) => candidate.type === "linkSummon")).toBe(false);

    const missing = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(missing, {
      0: { main: ["100"], extra: ["930"] },
      1: { main: ["400"] },
    });
    startDuel(missing);
    const material = queryPublicState(missing).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(material).toBeTruthy();
    moveDuelCard(missing.state, material!.uid, "monsterZone", 0);
    expect(getDuelLegalActions(missing, 0).some((candidate) => candidate.type === "linkSummon")).toBe(false);

    const full = createDuel({ seed: 1, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(full, {
      0: { main: ["100", "300", "500", "500", "500", "500", "500"], extra: ["930"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(full);
    const allMonsters = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster");
    expect(allMonsters).toHaveLength(7);
    for (const monster of allMonsters.slice(0, 5)) moveDuelCard(full.state, monster.uid, "monsterZone", 0);
    const link = queryPublicState(full).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "930");
    const materials = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "monsterZone" && (card.code === "100" || card.code === "300"));
    expect(link).toBeTruthy();
    expect(materials).toHaveLength(2);
    const action = getDuelLegalActions(full, 0).find((candidate) => candidate.type === "linkSummon" && candidate.uid === link!.uid);
    expect(action).toMatchObject({ type: "linkSummon", materialUids: materials.map((card) => card.uid) });

    linkSummonDuelCard(full.state, 0, link!.uid, materials.map((card) => card.uid));

    expect(full.state.cards.find((card) => card.uid === link!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(materials.every((material) => full.state.cards.find((card) => card.uid === material.uid)?.location === "graveyard")).toBe(true);
  });
});
