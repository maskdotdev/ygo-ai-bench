import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot card relation set validation", () => {
  it("rejects duplicate card target snapshots before restore", () => {
    const session = createDuel({ seed: 251, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const targetUid = serializeDuel(session).state.cards[1]!.uid;
    const duplicate = serializeDuel(session);
    duplicate.state.cards[0] = { ...duplicate.state.cards[0]!, cardTargetUids: [targetUid, targetUid] };

    expect(() => restoreDuel(duplicate, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.cardTargetUids must not contain duplicates");
  });

  it("rejects duplicate summon material snapshots before restore", () => {
    const session = createDuel({ seed: 252, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const materialUid = serializeDuel(session).state.cards[1]!.uid;
    const duplicate = serializeDuel(session);
    duplicate.state.cards[0] = { ...duplicate.state.cards[0]!, summonMaterialUids: [materialUid, materialUid] };

    expect(() => restoreDuel(duplicate, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.summonMaterialUids must not contain duplicates");
  });
});
