import { describe, expect, it } from "vitest";
import {
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel action legality", () => {
  it("hides set actions when the spell/trap zone is full", () => {
    const session = createDuel({ seed: 1, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["200", "200", "200", "200", "200", "200"] },
      1: { main: ["400", "400", "400", "400", "400", "400"] },
    });
    startDuel(session);

    const spells = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "spell");
    for (const card of spells.slice(0, 5)) moveDuelCard(session.state, card.uid, "spellTrapZone", 0);

    expect(getDuelLegalActions(session, 0).some((action) => action.type === "setSpellTrap")).toBe(false);
  });
});
