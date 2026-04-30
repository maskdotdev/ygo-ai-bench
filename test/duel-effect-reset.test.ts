import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, sendDuelCardToGraveyard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel effect reset", () => {
  const destinationCases = [
    { id: "reset-to-grave", flags: 0x1000 + 0x40000, destination: "graveyard" as const },
    { id: "reset-to-banished", flags: 0x1000 + 0x80000, destination: "banished" as const },
    { id: "reset-to-hand", flags: 0x1000 + 0x200000, destination: "hand" as const, start: "graveyard" as const },
    { id: "reset-to-deck", flags: 0x1000 + 0x400000, destination: "deck" as const },
  ];

  it.each(destinationCases)("removes $id effects only on their matching destination", ({ id, flags, destination, start }) => {
    const session = createDuel({ seed: 116, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeDefined();
    if (start) moveDuelCard(session.state, source!.uid, start, 0);
    registerEffect(session, {
      id,
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: [start ?? "hand"],
      reset: { flags },
      operation(ctx) {
        ctx.log("Destination reset effect should not resolve");
      },
    });

    moveDuelCard(session.state, source!.uid, destination, 0);

    expect(session.state.effects).toHaveLength(0);
  });

  it("keeps destination reset effects on non-matching destinations", () => {
    const session = createDuel({ seed: 117, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeDefined();
    registerEffect(session, {
      id: "reset-only-to-grave",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      reset: { flags: 0x1000 + 0x40000 },
      operation(ctx) {
        ctx.log("Destination reset effect remains");
      },
    });

    moveDuelCard(session.state, source!.uid, "banished", 0);

    expect(session.state.effects).toHaveLength(1);
    expect(session.state.effects[0]).toMatchObject({ id: "reset-only-to-grave" });
  });

  it("removes reset-leave effects when their source changes location", () => {
    const session = createDuel({ seed: 118, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeDefined();
    registerEffect(session, {
      id: "reset-on-leave",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand", "graveyard"],
      reset: { flags: 0x1000 + 0x800000 },
      operation(ctx) {
        ctx.log("Leave reset effect should not resolve");
      },
    });

    moveDuelCard(session.state, source!.uid, "graveyard", 0);

    expect(session.state.effects).toHaveLength(0);
  });

  it("removes reset-event effects when their source leaves range", () => {
    const session = createDuel({ seed: 113, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeDefined();
    registerEffect(session, {
      id: "reset-when-leaving-hand",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      reset: { flags: 0x1000 },
      operation(ctx) {
        ctx.log("Reset effect should not resolve");
      },
    });
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "reset-when-leaving-hand")).toBe(true);

    moveDuelCard(session.state, source!.uid, "graveyard", 0);

    expect(session.state.effects).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "reset-when-leaving-hand")).toBe(false);
  });

  it("keeps reset-event effects while their source remains in range", () => {
    const session = createDuel({ seed: 114, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeDefined();
    registerEffect(session, {
      id: "reset-stays-in-range",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand", "graveyard"],
      reset: { flags: 0x1000 },
      operation(ctx) {
        ctx.log("Reset effect remains");
      },
    });

    moveDuelCard(session.state, source!.uid, "graveyard", 0);

    expect(session.state.effects).toHaveLength(1);
    expect(session.state.effects[0]).toMatchObject({ id: "reset-stays-in-range" });
  });

  it("restores reset-pruned effects after failed operation rollback", () => {
    const session = createDuel({ seed: 120, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const resetSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeDefined();
    expect(resetSource).toBeDefined();
    registerEffect(session, {
      id: "rollback-reset-pruned-effect",
      sourceUid: resetSource!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      reset: { flags: 0x1000 + 0x40000 },
      operation(ctx) {
        ctx.log("Restored reset effect");
      },
    });
    registerEffect(session, {
      id: "failing-reset-prune-move",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, resetSource!.uid, ctx.player);
        throw new Error("reset prune rollback failed");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "failing-reset-prune-move");
    expect(action).toBeDefined();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("reset prune rollback failed");
    expect(session.state.cards.find((card) => card.uid === resetSource!.uid)?.location).toBe("hand");
    expect(session.state.effects.some((effect) => effect.id === "rollback-reset-pruned-effect")).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "rollback-reset-pruned-effect")).toBe(true);
  });
});
