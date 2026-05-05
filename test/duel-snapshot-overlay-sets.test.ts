import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot overlay set validation", () => {
  it("rejects duplicate overlay material references before restore", () => {
    const session = createDuel({
      seed: 253,
      startingHandSize: 1,
      cardReader: createCardReader(cards),
    });

    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["400"] } });
    startDuel(session);

    const snapshot = serializeDuel(session);
    const overlayUid = snapshot.state.cards[1]!.uid;
    snapshot.state.cards[1] = { ...snapshot.state.cards[1]!, location: "overlay" };
    snapshot.state.cards[0] = { ...snapshot.state.cards[0]!, overlayUids: [overlayUid, overlayUid] };

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow(
      "Malformed duel snapshot: state.cards.0.overlayUids must not contain duplicates",
    );
  });
});
