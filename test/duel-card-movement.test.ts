import { describe, expect, it } from "vitest";
import {
  applyResponse,
  banishDuelCard,
  canMoveDuelCardToLocation,
  createDuel,
  destroyDuelCard,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  sendDuelCardToGraveyard,
  startDuel,
} from "#duel/core.js";
import { hasZoneSpace, moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel card movement", () => {
  it("treats disabled field zones as unavailable for placement", () => {
    const session = createDuel({ seed: 260, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    registerEffect(session, {
      id: "disable-first-two-monster-zones",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 260,
      value: 0b00011,
      range: ["hand"],
      operation() {},
    });

    expect(hasZoneSpace(session.state, 0, "monsterZone")).toBe(true);
    expect(moveDuelCard(session.state, target!.uid, "monsterZone", 0).sequence).toBe(2);

    registerEffect(session, {
      id: "disable-remaining-monster-zones",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 260,
      value: 0b11100,
      range: ["hand"],
      operation() {},
    });
    expect(hasZoneSpace(session.state, 0, "monsterZone")).toBe(false);
  });

  it("collects trigger effects after a card is sent to the graveyard", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const sent = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(source).toBeTruthy();
    expect(sent).toBeTruthy();
    expect(triggerSource).toBeTruthy();

    registerEffect(session, {
      id: "send-card",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, sent!.uid, ctx.player);
      },
    });
    registerEffect(session, {
      id: "on-sent",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "sentToGraveyard",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Saw ${ctx.eventCard?.name ?? "missing card"} sent`);
      },
    });

    const activation = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "send-card");
    expect(activation).toBeTruthy();
    const activationResult = applyResponse(session, activation!);

    expect(activationResult.ok).toBe(true);
    expect(activationResult.state.cards.find((card) => card.uid === sent!.uid)?.location).toBe("graveyard");
    expect(activationResult.state.pendingTriggers).toHaveLength(1);
    expect(activationResult.state.pendingTriggers[0]).toMatchObject({ eventName: "sentToGraveyard", eventCardUid: sent!.uid });
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "on-sent");
    expect(trigger).toBeTruthy();
    const triggerResult = applyResponse(session, trigger!);

    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.state.log.some((entry) => entry.detail.includes("Second Monster sent"))).toBe(true);
  });

  it("moves cards through destroy and banish primitives", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const destroyed = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const banished = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(destroyed).toBeTruthy();
    expect(banished).toBeTruthy();

    destroyDuelCard(session.state, destroyed!.uid, 0);
    banishDuelCard(session.state, banished!.uid, 0);
    const state = queryPublicState(session);

    expect(state.cards.find((card) => card.uid === destroyed!.uid)?.location).toBe("graveyard");
    expect(state.cards.find((card) => card.uid === banished!.uid)?.location).toBe("banished");
    expect(state.log.some((entry) => entry.action === "destroy" && entry.card === "Normal Test Monster")).toBe(true);
    expect(state.log.some((entry) => entry.action === "banish" && entry.card === "Second Monster")).toBe(true);
    expect(canMoveDuelCardToLocation(session.state, destroyed!.uid, "graveyard")).toBe(false);
    expect(canMoveDuelCardToLocation(session.state, banished!.uid, "banished")).toBe(false);
    expect(() => sendDuelCardToGraveyard(session.state, destroyed!.uid, 0)).toThrow("cannot move to graveyard");
    expect(() => banishDuelCard(session.state, banished!.uid, 0)).toThrow("cannot move to banished");
  });

  it("applies destroy replacement effects before moving the destroyed card", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const threatened = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const replacement = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(threatened).toBeTruthy();
    expect(replacement).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "destroy-replace",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 50,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      target(ctx) {
        ctx.setTargets([replacement!.uid]);
        return true;
      },
      operation(ctx) {
        const [selected] = ctx.getTargets();
        if (selected) sendDuelCardToGraveyard(ctx.duel, selected.uid, ctx.player);
      },
    });

    destroyDuelCard(session.state, threatened!.uid, 0);
    const state = queryPublicState(session);

    expect(state.cards.find((card) => card.uid === threatened!.uid)?.location).toBe("hand");
    expect(state.cards.find((card) => card.uid === replacement!.uid)?.location).toBe("graveyard");
    expect(state.log.some((entry) => entry.action === "destroyReplace" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("applies release replacement effects before moving the released card", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const threatened = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const replacement = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(threatened).toBeTruthy();
    expect(replacement).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "release-replace",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 51,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      target(ctx) {
        ctx.setTargets([replacement!.uid]);
        return true;
      },
      operation(ctx) {
        const [selected] = ctx.getTargets();
        if (selected) sendDuelCardToGraveyard(ctx.duel, selected.uid, ctx.player, duelReason.release | duelReason.replace);
      },
    });

    sendDuelCardToGraveyard(session.state, threatened!.uid, 0, duelReason.release | duelReason.cost);
    const state = queryPublicState(session);

    expect(state.cards.find((card) => card.uid === threatened!.uid)?.location).toBe("hand");
    expect(state.cards.find((card) => card.uid === replacement!.uid)?.location).toBe("graveyard");
    expect(state.log.some((entry) => entry.action === "releaseReplace" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("blocks non-summon releases with unreleasable effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const threatened = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(threatened).toBeTruthy();

    registerEffect(session, {
      id: "unreleasable-nonsummon",
      sourceUid: threatened!.uid,
      controller: 0,
      event: "continuous",
      code: 44,
      range: ["hand"],
      operation() {},
    });

    expect(() => sendDuelCardToGraveyard(session.state, threatened!.uid, 0, duelReason.release | duelReason.cost)).toThrow("cannot be released");
    expect(session.state.cards.find((card) => card.uid === threatened!.uid)?.location).toBe("hand");
  });

  it("applies send replacement effects before sending a card to the graveyard", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const threatened = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const replacement = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(threatened).toBeTruthy();
    expect(replacement).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "send-replace",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 52,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      target(ctx) {
        ctx.setTargets([replacement!.uid]);
        return true;
      },
      operation(ctx) {
        const [selected] = ctx.getTargets();
        if (selected) sendDuelCardToGraveyard(ctx.duel, selected.uid, ctx.player, duelReason.effect | duelReason.replace);
      },
    });

    sendDuelCardToGraveyard(session.state, threatened!.uid, 0, duelReason.effect);
    const state = queryPublicState(session);

    expect(state.cards.find((card) => card.uid === threatened!.uid)?.location).toBe("hand");
    expect(state.cards.find((card) => card.uid === replacement!.uid)?.location).toBe("graveyard");
    expect(state.log.some((entry) => entry.action === "sendReplace" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("prevents moves with continuous cannot-move effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const graveBlocked = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const banishBlocked = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(graveBlocked).toBeTruthy();
    expect(banishBlocked).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "cannot-grave",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 68,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      operation() {},
    });
    registerEffect(session, {
      id: "cannot-banish",
      sourceUid: banishBlocked!.uid,
      controller: 0,
      event: "continuous",
      code: 67,
      range: ["hand"],
      operation() {},
    });

    expect(canMoveDuelCardToLocation(session.state, graveBlocked!.uid, "graveyard")).toBe(false);
    expect(canMoveDuelCardToLocation(session.state, banishBlocked!.uid, "banished")).toBe(false);
    expect(() => sendDuelCardToGraveyard(session.state, graveBlocked!.uid, 0)).toThrow("cannot move to graveyard");
    expect(() => banishDuelCard(session.state, banishBlocked!.uid, 0)).toThrow("cannot move to banished");
  });
});
