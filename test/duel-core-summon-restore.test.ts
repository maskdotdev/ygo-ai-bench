import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("core summon restore", () => {
  it("restores Normal Summon legal actions and applies the restored action", () => {
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
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === monster!.uid);
    expect(action).toBeDefined();

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(result.state.players[0].normalSummonAvailable).toBe(false);
  });

  it("restores Tribute Summon legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["600", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "600");
    const tribute = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tributeMonster).toBeTruthy();
    expect(tribute).toBeTruthy();
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "tributeSummon" && candidate.uid === tributeMonster!.uid && candidate.tributeUids.includes(tribute!.uid));
    expect(action?.type).toBe("tributeSummon");
    if (!action || action.type !== "tributeSummon") throw new Error("Expected restored Tribute Summon action");

    const result = applyResponse(restored, action);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === tribute!.uid)?.location).toBe("graveyard");
    expect(result.state.cards.find((card) => card.uid === tributeMonster!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(result.state.players[0].normalSummonAvailable).toBe(false);
  });

  it("restores Flip Summon legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["300"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(monster).toBeTruthy();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceDownDefense";
    session.state.cards.find((card) => card.uid === monster!.uid)!.faceUp = false;

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === monster!.uid);
    expect(action).toBeDefined();

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack", faceUp: true });
  });

  it("restores Ritual Summon legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["940", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const ritual = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "940");
    expect(ritual).toBeTruthy();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "ritualSummon" && candidate.uid === ritual!.uid);
    expect(action?.type).toBe("ritualSummon");
    if (!action || action.type !== "ritualSummon") throw new Error("Expected restored Ritual Summon action");

    const result = applyResponse(restored, action);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === ritual!.uid)).toMatchObject({ location: "monsterZone", faceUp: true });
    expect(action.materialUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
  });
});
