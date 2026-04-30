import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, startDuel } from "#duel/core.js";
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
});
