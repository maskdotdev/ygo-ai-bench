import { describe, expect, it } from "vitest";
import {
  applyResponse,
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

  it("rejects malformed responses missing required action fields at the legality boundary", () => {
    const session = createDuel({ seed: 2, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const result = applyResponse(session, { type: "normalSummon", player: 0, label: "Malformed Normal Summon" } as never);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Response is not currently legal");
    expect(session.state.actionWindowId).toBe(0);
    expect(session.state.cards.find((card) => card.code === "100")?.location).toBe("hand");
  });

  it("rejects malformed material responses at the legality boundary", () => {
    const session = createDuel({ seed: 3, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    const fusion = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    expect(fusion).toBeDefined();
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "fusionSummon" && action.uid === fusion!.uid)).toBe(true);

    const result = applyResponse(session, { type: "fusionSummon", player: 0, uid: fusion!.uid, label: "Malformed Fusion Summon" } as never);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Response is not currently legal");
    expect(session.state.actionWindowId).toBe(0);
    expect(session.state.cards.find((card) => card.uid === fusion!.uid)?.location).toBe("extraDeck");
  });
});
