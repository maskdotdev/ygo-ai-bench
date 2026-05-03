import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  ritualSummonDuelCard,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel ritual summons", () => {
  it("ritual summons from the hand using hand materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const ritual = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    expect(ritual).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "ritualSummon" && candidate.uid === ritual!.uid);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("ritualSummon");
    if (!action || action.type !== "ritualSummon") throw new Error("Expected ritual summon action");
    const result = applyResponse(session, action);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === ritual!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === ritual!.uid)?.position).toBe("faceUpAttack");
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "ritualSummon" && entry.card === "Ritual Test Monster")).toBe(true);
  });

  it("ritual summons using mixed hand and field materials and emits special summon triggers", () => {
    const session = createDuel({ seed: 1, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300", "500"] },
      1: { main: ["400", "400", "400", "400"] },
    });
    startDuel(session);

    const ritual = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const fieldMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(ritual).toBeTruthy();
    expect(fieldMaterial).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    moveDuelCard(session.state, fieldMaterial!.uid, "monsterZone", 0);
    registerEffect(session, {
      id: "ritual-special-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Ritual special summoned ${ctx.eventCard?.name}`);
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "ritualSummon" && candidate.uid === ritual!.uid);
    expect(action).toBeTruthy();
    const summonResult = applyResponse(session, action!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.cards.find((card) => card.uid === fieldMaterial!.uid)?.location).toBe("graveyard");
    expect(summonResult.state.pendingTriggers).toHaveLength(1);
    expect(summonResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: ritual!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "ritual-special-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Ritual special summoned Ritual Test Monster")).toBe(true);
  });

  it("matches explicit ritual materials through card aliases", () => {
    const session = createDuel({
      seed: 1,
      startingHandSize: 3,
      cardReader: createCardReader([
        { code: "100", alias: "101", name: "Aliased Ritual Material", kind: "monster" },
        { code: "300", name: "Second Ritual Material", kind: "monster" },
        { code: "940", name: "Alias Ritual", kind: "monster", ritualMaterials: ["101", "300"] },
      ]),
    });
    loadDecks(session, {
      0: { main: ["940", "100", "300"] },
      1: { main: ["300", "300", "300"] },
    });
    startDuel(session);

    const ritual = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const aliasMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const otherMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(ritual).toBeTruthy();
    expect(aliasMaterial).toBeTruthy();
    expect(otherMaterial).toBeTruthy();

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "ritualSummon" && candidate.uid === ritual!.uid);
    expect(action).toBeTruthy();
    expect(action).toMatchObject({ materialUids: [aliasMaterial!.uid, otherMaterial!.uid] });

    ritualSummonDuelCard(session.state, 0, ritual!.uid, [aliasMaterial!.uid, otherMaterial!.uid]);

    expect(session.state.cards.find((card) => card.uid === ritual!.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === aliasMaterial!.uid)?.location).toBe("graveyard");
    expect(session.state.cards.find((card) => card.uid === otherMaterial!.uid)?.location).toBe("graveyard");
  });

  it("blocks ritual summons when material cannot be sent to the graveyard", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const ritual = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const blockedMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const otherMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(ritual).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();
    expect(otherMaterial).toBeTruthy();

    registerEffect(session, {
      id: "ritual-material-grave-block",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 68,
      range: ["hand"],
      operation() {},
    });

    expect(() => ritualSummonDuelCard(session.state, 0, ritual!.uid, [blockedMaterial!.uid, otherMaterial!.uid])).toThrow("cannot move to graveyard");
    expect(session.state.cards.find((card) => card.uid === ritual!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("hand");
  });

  it("blocks ritual summons when material cannot be used as material", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const ritual = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const blockedMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const otherMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(ritual).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();
    expect(otherMaterial).toBeTruthy();

    registerEffect(session, {
      id: "ritual-cannot-be-material",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 248,
      range: ["hand"],
      operation() {},
    });

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "ritualSummon" && candidate.uid === ritual!.uid)).toBe(false);
    expect(() => ritualSummonDuelCard(session.state, 0, ritual!.uid, [blockedMaterial!.uid, otherMaterial!.uid])).toThrow("cannot be used as ritual material");
    expect(session.state.cards.find((card) => card.uid === ritual!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)?.location).toBe("hand");
  });

  it("rejects matching-code non-monsters as direct ritual materials", () => {
    const session = createDuel({
      seed: 1,
      startingHandSize: 3,
      cardReader: createCardReader([
        { code: "100", name: "Ritual Material Spell", kind: "spell" },
        { code: "300", name: "Real Ritual Material", kind: "monster" },
        { code: "940", name: "Spell-Proof Ritual", kind: "monster", ritualMaterials: ["100", "300"] },
      ]),
    });
    loadDecks(session, {
      0: { main: ["940", "100", "300"] },
      1: { main: ["300", "300", "300"] },
    });
    startDuel(session);

    const ritual = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const spell = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(ritual).toBeTruthy();
    expect(spell).toBeTruthy();
    expect(monster).toBeTruthy();

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "ritualSummon" && candidate.uid === ritual!.uid)).toBe(false);
    expect(() => ritualSummonDuelCard(session.state, 0, ritual!.uid, [spell!.uid, monster!.uid])).toThrow("cannot be used as ritual material");
    expect(session.state.cards.find((card) => card.uid === ritual!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === spell!.uid)?.location).toBe("hand");
  });

  it("does not expose ritual summon actions without materials or with no monster zone space", () => {
    const missing = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(missing, {
      0: { main: ["940", "100"] },
      1: { main: ["400", "400"] },
    });
    startDuel(missing);
    expect(getDuelLegalActions(missing, 0).some((candidate) => candidate.type === "ritualSummon")).toBe(false);

    const duplicate = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(duplicate, {
      0: { main: ["940", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(duplicate);
    const duplicateRitual = queryPublicState(duplicate).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const duplicateMaterial = queryPublicState(duplicate).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(duplicateRitual).toBeTruthy();
    expect(duplicateMaterial).toBeTruthy();
    expect(() => ritualSummonDuelCard(duplicate.state, 0, duplicateRitual!.uid, [duplicateMaterial!.uid, duplicateMaterial!.uid])).toThrow("ritual materials must be unique");

    const full = createDuel({ seed: 1, startingHandSize: 8, cardReader: createCardReader(cards) });
    loadDecks(full, {
      0: { main: ["940", "100", "300", "500", "500", "500", "500", "500"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(full);
    const blockers = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster" && card.code === "500");
    expect(blockers).toHaveLength(5);
    for (const blocker of blockers) moveDuelCard(full.state, blocker.uid, "monsterZone", 0);
    expect(getDuelLegalActions(full, 0).some((candidate) => candidate.type === "ritualSummon")).toBe(false);

    const ritual = queryPublicState(full).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const materials = queryPublicState(full).cards.filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"));
    expect(ritual).toBeTruthy();
    expect(materials).toHaveLength(2);
    expect(() => ritualSummonDuelCard(full.state, 0, ritual!.uid, materials.map((card) => card.uid))).toThrow("monsterZone is full");
  });

  it("counts selected field ritual materials as freeing zone space", () => {
    const session = createDuel({ seed: 1, startingHandSize: 8, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300", "500", "500", "500", "500", "500"] },
      1: { main: ["400", "400", "400", "400", "400", "400", "400", "400"] },
    });
    startDuel(session);
    const firstMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const blockers = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster" && card.code === "500");
    expect(firstMaterial).toBeTruthy();
    expect(blockers).toHaveLength(5);
    moveDuelCard(session.state, firstMaterial!.uid, "monsterZone", 0);
    for (const blocker of blockers.slice(0, 4)) moveDuelCard(session.state, blocker.uid, "monsterZone", 0);

    const ritual = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    const secondMaterial = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(ritual).toBeTruthy();
    expect(secondMaterial).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "ritualSummon" && candidate.uid === ritual!.uid);
    expect(action).toMatchObject({ type: "ritualSummon", materialUids: [firstMaterial!.uid, secondMaterial!.uid] });

    ritualSummonDuelCard(session.state, 0, ritual!.uid, [firstMaterial!.uid, secondMaterial!.uid]);

    expect(session.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)?.location).toBe("graveyard");
    expect(session.state.cards.find((card) => card.uid === secondMaterial!.uid)?.location).toBe("graveyard");
  });
});
