import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel effect reset", () => {
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
