import { describe, expect, it } from "vitest";
import {
  applyResponse,
  canChangeDuelCardPosition,
  changeDuelCardPosition,
  createDuel,
  flipSummonDuelCard,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  restoreDuel,
  serializeDuel,
  specialSummonDuelCard,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel position changes", () => {
  it("sets a monster face-down and flip summons it later", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();
    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === monster!.uid);
    expect(setAction).toBeTruthy();
    const setResult = applyResponse(session, setAction!);

    expect(setResult.ok).toBe(true);
    expect(setResult.state.cards.find((card) => card.uid === monster!.uid)?.position).toBe("faceDownDefense");
    expect(setResult.state.cards.find((card) => card.uid === monster!.uid)?.faceUp).toBe(false);
    expect(setResult.state.players[0].normalSummonAvailable).toBe(false);

    const flipAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === monster!.uid);
    expect(flipAction).toBeTruthy();
    const flipResult = applyResponse(session, flipAction!);

    expect(flipResult.ok).toBe(true);
    expect(flipResult.state.cards.find((card) => card.uid === monster!.uid)?.position).toBe("faceUpAttack");
    expect(flipResult.state.cards.find((card) => card.uid === monster!.uid)?.faceUp).toBe(true);
    expect(flipResult.state.log.some((entry) => entry.action === "flipSummon" && entry.card === "Normal Test Monster")).toBe(true);
  });

  it("collects flip summon trigger effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(monster).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceDownDefense";
    session.state.cards.find((card) => card.uid === monster!.uid)!.faceUp = false;
    registerEffect(session, {
      id: "flip-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "flipSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Flip summoned ${ctx.eventCard?.name}`);
      },
    });

    flipSummonDuelCard(session.state, 0, monster!.uid);

    const state = queryPublicState(session);
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0]).toMatchObject({ eventName: "flipSummoned", eventCardUid: monster!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "flip-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Flip summoned Normal Test Monster")).toBe(true);
  });

  it("changes monster battle position once per turn", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();
    specialSummonDuelCard(session.state, monster!.uid, 0);
    expect(canChangeDuelCardPosition(session.state, monster!.uid, "faceUpDefense")).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePosition" && candidate.uid === monster!.uid && candidate.position === "faceUpDefense");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === monster!.uid)?.position).toBe("faceUpDefense");
    expect(result.state.positionsChanged).toContain(monster!.uid);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "changePosition" && candidate.uid === monster!.uid)).toBe(false);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.positionsChanged).toContain(monster!.uid);
  });

  it("collects position-change trigger effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(monster).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    specialSummonDuelCard(session.state, monster!.uid, 0);
    registerEffect(session, {
      id: "position-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "positionChanged",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Position changed ${ctx.eventCard?.name}`);
      },
    });

    changeDuelCardPosition(session.state, 0, monster!.uid, "faceUpDefense");

    const state = queryPublicState(session);
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0]).toMatchObject({ eventName: "positionChanged", eventCardUid: monster!.uid });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "position-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Position changed Normal Test Monster")).toBe(true);
  });
});
