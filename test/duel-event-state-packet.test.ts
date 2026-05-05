import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";

describe("duel event state packets", () => {
  it("freezes event card previous and current state in history, pending triggers, and snapshots", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Moved Event Card", kind: "monster" },
      { code: "200", name: "Move Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 261, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const moved = session.state.cards.find((card) => card.code === "100");
    const watcher = session.state.cards.find((card) => card.code === "200");
    expect(moved).toBeDefined();
    expect(watcher).toBeDefined();
    const previousSequence = moved!.sequence;
    const previousPosition = moved!.position;

    session.state.effects.push({
      id: "watch-sent",
      sourceUid: watcher!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "sentToGraveyard",
      triggerTiming: "if",
      range: ["hand"],
      operation() {},
    });

    sendDuelCardToGraveyard(session.state, moved!.uid, 0);

    const expectedPrevious = {
      controller: 0,
      location: "hand",
      sequence: previousSequence,
      position: previousPosition,
      faceUp: false,
    };
    const expectedCurrent = {
      controller: 0,
      location: "graveyard",
      sequence: 0,
      position: previousPosition,
      faceUp: true,
    };

    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToGraveyard", eventCardUid: moved!.uid, eventPreviousState: expectedPrevious, eventCurrentState: expectedCurrent })]),
    );
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([expect.objectContaining({ effectId: "watch-sent", eventCardUid: moved!.uid, eventPreviousState: expectedPrevious, eventCurrentState: expectedCurrent })]),
    );

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {}, {}, { pruneUnrestoredPendingTriggers: false });
    expect(restored.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "sentToGraveyard", eventCardUid: moved!.uid, eventPreviousState: expectedPrevious, eventCurrentState: expectedCurrent })]),
    );
    expect(restored.state.pendingTriggers).toEqual(
      expect.arrayContaining([expect.objectContaining({ effectId: "watch-sent", eventCardUid: moved!.uid, eventPreviousState: expectedPrevious, eventCurrentState: expectedCurrent })]),
    );
  });
});
