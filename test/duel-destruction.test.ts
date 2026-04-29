import { describe, expect, it } from "vitest";
import { createDuel, destroyDuelCard, loadDecks, queryPublicState, registerEffect, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel destruction", () => {
  it("prevents effect destruction with indestructible effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const protectedCard = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(protectedCard).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "effect-indestructible",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 41,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      operation() {},
    });

    destroyDuelCard(session.state, protectedCard!.uid, 0);

    expect(queryPublicState(session).cards.find((card) => card.uid === protectedCard!.uid)?.location).toBe("hand");
    expect(queryPublicState(session).log.some((entry) => entry.action === "destroyPrevented" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("consumes counted indestructible effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "500"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const protectedCard = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(protectedCard).toBeTruthy();
    expect(source).toBeTruthy();

    registerEffect(session, {
      id: "counted-indestructible",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 47,
      value: 1,
      property: 0x800,
      targetRange: [1, 0],
      range: ["hand"],
      operation() {},
    });

    destroyDuelCard(session.state, protectedCard!.uid, 0);
    expect(queryPublicState(session).cards.find((card) => card.uid === protectedCard!.uid)?.location).toBe("hand");

    destroyDuelCard(session.state, protectedCard!.uid, 0);
    expect(queryPublicState(session).cards.find((card) => card.uid === protectedCard!.uid)?.location).toBe("graveyard");
  });
});
