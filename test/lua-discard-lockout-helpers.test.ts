import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, registerEffect, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua discard lockout helpers", () => {
  it("applies cannot-discard-deck effects to Lua predicates and operations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Deck Discard Lock Source", kind: "monster" },
      { code: "200", name: "Blocked Deck Discard", kind: "monster" },
    ];
    const session = createDuel({ seed: 210, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "deck" && card.code === "100");
    expect(source).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    registerEffect(session, {
      id: "cannot-discard-deck",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 56,
      range: ["hand"],
      operation: () => undefined,
    });

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("can discard deck locked " .. tostring(Duel.IsPlayerCanDiscardDeck(0, 1)))
      Debug.Message("can discard deck cost locked " .. tostring(Duel.IsPlayerCanDiscardDeckAsCost(0, 1)))
      Debug.Message("discard deck locked " .. Duel.DiscardDeck(0, 1, REASON_EFFECT))
      Debug.Message("discard deck operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "cannot-discard-deck.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "can discard deck locked false",
      "can discard deck cost locked false",
      "discard deck locked 0",
      "discard deck operated 0",
    ]);
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "deck" });
  });

  it("applies cannot-discard-hand effects to Lua predicates and operations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Hand Discard Lock Source", kind: "monster" },
      { code: "200", name: "Blocked Hand Discard", kind: "monster" },
    ];
    const session = createDuel({ seed: 211, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "deck" && card.code === "100");
    const candidate = session.state.cards.find((card) => card.controller === 0 && card.location === "deck" && card.code === "200");
    expect(source).toBeDefined();
    expect(candidate).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, candidate!.uid, "hand", 0);
    registerEffect(session, {
      id: "cannot-discard-hand",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 55,
      range: ["hand"],
      operation: () => undefined,
    });

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("can discard hand locked " .. tostring(Duel.IsPlayerCanDiscardHand(0, 1)))
      Debug.Message("discard hand locked " .. Duel.DiscardHand(0, aux.TRUE, 1, 1, REASON_EFFECT))
      Debug.Message("discard hand operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "cannot-discard-hand.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["can discard hand locked false", "discard hand locked 0", "discard hand operated 0"]);
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand" });
  });
});
