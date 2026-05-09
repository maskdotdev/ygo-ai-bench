import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter } from "#duel/counters.js";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";

describe("duel counter reset parity", () => {
  it("clears permanent and resettable counters on EDOPro movement reset destinations", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Counter Reset Target", kind: "monster" }];
    const session = createDuel({ seed: 245, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    expect(addDuelCardCounter(target, 99, 2)).toBe(true);
    expect(addDuelCardCounter(target, 0x1000 + 88, 3, "permanent")).toBe(true);
    expect(target!.counters).toEqual({ 99: 2, [0x1000 + 88]: 3 });

    moveDuelCard(session.state, target!.uid, "graveyard", 0);

    expect(target!.counters).toBeUndefined();
    expect(target!.counterBuckets).toBeUndefined();
  });

  it("preserves counters on control-only moves but clears them on field entry and monster-spell zone changes", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Counter Target", kind: "monster" },
      { code: "200", name: "Hand Counter Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 246, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);
    const fieldTarget = session.state.cards.find((card) => card.code === "100");
    const handTarget = session.state.cards.find((card) => card.code === "200");
    expect(fieldTarget).toBeDefined();
    expect(handTarget).toBeDefined();
    moveDuelCard(session.state, fieldTarget!.uid, "monsterZone", 0);

    expect(addDuelCardCounter(fieldTarget, 99, 2)).toBe(true);
    moveDuelCard(session.state, fieldTarget!.uid, "monsterZone", 1);
    expect(fieldTarget!.counters).toEqual({ 99: 2 });
    moveDuelCard(session.state, fieldTarget!.uid, "spellTrapZone", 1);
    expect(fieldTarget!.counters).toBeUndefined();

    expect(addDuelCardCounter(handTarget, 77, 1)).toBe(true);
    moveDuelCard(session.state, handTarget!.uid, "monsterZone", 0);
    expect(handTarget!.counters).toBeUndefined();
  });
});
