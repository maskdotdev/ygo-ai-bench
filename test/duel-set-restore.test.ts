import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("set action restore", () => {
  it("restores monster set legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === monster!.uid);
    expect(action).toBeDefined();

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });
    expect(result.state.players[0].normalSummonAvailable).toBe(false);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.state.log.some((entry) => entry.action === "setMonster" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("restores spell/trap set legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["200"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const spell = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(spell).toBeTruthy();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "setSpellTrap" && candidate.uid === spell!.uid);
    expect(action).toBeDefined();

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === spell!.uid)).toMatchObject({ location: "spellTrapZone", position: "faceDown", faceUp: false });
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.state.log.some((entry) => entry.action === "set" && entry.card === "Test Spell")).toBe(true);
  });
});
