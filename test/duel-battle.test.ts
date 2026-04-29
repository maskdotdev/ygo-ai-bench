import { describe, expect, it } from "vitest";
import {
  applyResponse,
  canDuelCardAttack,
  createDuel,
  damageDuelPlayer,
  declareDuelAttack,
  flipSummonDuelCard,
  getDuelAttackTargets,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  recoverDuelPlayer,
  registerEffect,
  restoreDuel,
  serializeDuel,
  setDuelPlayerLifePoints,
  specialSummonDuelCard,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel battle", () => {
  it("declares a direct attack and tracks attackers for the battle phase", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    expect(canDuelCardAttack(session.state, attacker!.uid)).toBe(true);
    expect(getDuelAttackTargets(session.state, attacker!.uid)).toHaveLength(0);

    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid);
    expect(attack).toBeTruthy();
    const attackResult = applyResponse(session, attack!);

    expect(attackResult.ok).toBe(true);
    expect(attackResult.state.players[1].lifePoints).toBe(6200);
    expect(attackResult.state.attacksDeclared).toContain(attacker!.uid);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid)).toBe(false);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.attacksDeclared).toContain(attacker!.uid);
  });

  it("tracks summon and attack activity counts through snapshots and turn reset", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const flip = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(flip).toBeTruthy();
    expect(session.state.activityCounts[0]).toEqual({ summon: 0, normalSummon: 0, specialSummon: 0, flipSummon: 0, attack: 0 });

    specialSummonDuelCard(session.state, attacker!.uid, 0);
    moveDuelCard(session.state, flip!.uid, "monsterZone", 0).position = "faceDownDefense";
    session.state.cards.find((card) => card.uid === flip!.uid)!.faceUp = false;
    flipSummonDuelCard(session.state, 0, flip!.uid);

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid);
    expect(attack).toBeTruthy();
    expect(applyResponse(session, attack!).ok).toBe(true);

    expect(session.state.activityCounts[0]).toEqual({ summon: 2, normalSummon: 0, specialSummon: 1, flipSummon: 1, attack: 1 });
    expect(queryPublicState(session).activityCounts[0]).toEqual(session.state.activityCounts[0]);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.activityCounts[0]).toEqual(session.state.activityCounts[0]);

    const end = getDuelLegalActions(session, 0).find((action) => action.type === "endTurn");
    expect(end).toBeTruthy();
    expect(applyResponse(session, end!).ok).toBe(true);
    expect(session.state.activityCounts[0]).toEqual({ summon: 0, normalSummon: 0, specialSummon: 0, flipSummon: 0, attack: 0 });
  });

  it("resolves attack-position monster battles with destruction and battle damage", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["500"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    specialSummonDuelCard(session.state, target!.uid, 1);

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    expect(getDuelAttackTargets(session.state, attacker!.uid).map((card) => card.uid)).toEqual([target!.uid]);

    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.targetUid === target!.uid);
    expect(attack).toBeTruthy();
    const result = applyResponse(session, attack!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === attacker!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("graveyard");
    expect(result.state.players[1].lifePoints).toBe(7100);
    expect(result.state.log.some((entry) => entry.action === "destroy" && entry.card === "Opponent Monster")).toBe(true);
  });

  it("prevents battle destruction with indestructible effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["500"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    specialSummonDuelCard(session.state, target!.uid, 1);
    registerEffect(session, {
      id: "battle-indestructible",
      sourceUid: target!.uid,
      controller: 1,
      event: "continuous",
      code: 42,
      range: ["monsterZone"],
      operation() {},
    });

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.targetUid === target!.uid);
    expect(attack).toBeTruthy();
    const result = applyResponse(session, attack!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("monsterZone");
    expect(result.state.players[1].lifePoints).toBe(7100);
    expect(result.state.pendingTriggers).toHaveLength(0);
    expect(result.state.log.some((entry) => entry.action === "destroyPrevented" && entry.card === "Opponent Monster")).toBe(true);
  });

  it("collects battle destruction trigger effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["500", "200"] },
      1: { main: ["400", "200"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "200");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    specialSummonDuelCard(session.state, target!.uid, 1);
    registerEffect(session, {
      id: "battle-destroyed-trigger",
      sourceUid: triggerSource!.uid,
      controller: 1,
      event: "trigger",
      triggerEvent: "battleDestroyed",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Battle destroyed ${ctx.eventCard?.name}`);
      },
    });

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.targetUid === target!.uid);
    expect(attack).toBeTruthy();
    const attackResult = applyResponse(session, attack!);

    expect(attackResult.ok).toBe(true);
    expect(attackResult.state.pendingTriggers).toHaveLength(1);
    expect(attackResult.state.pendingTriggers[0]).toMatchObject({ eventName: "battleDestroyed", eventCardUid: target!.uid });

    const trigger = getDuelLegalActions(session, 1).find((action) => action.type === "activateTrigger" && action.effectId === "battle-destroyed-trigger");
    expect(trigger).toBeTruthy();
    const result = applyResponse(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Battle destroyed Opponent Monster")).toBe(true);
  });

  it("resolves defense-position battles without destroying the attacker", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["300"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    specialSummonDuelCard(session.state, target!.uid, 1);
    const targetState = session.state.cards.find((card) => card.uid === target!.uid);
    expect(targetState).toBeTruthy();
    targetState!.position = "faceUpDefense";

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    declareDuelAttack(session.state, 0, attacker!.uid, target!.uid);

    const state = queryPublicState(session);
    expect(state.cards.find((card) => card.uid === attacker!.uid)?.location).toBe("monsterZone");
    expect(state.cards.find((card) => card.uid === target!.uid)?.location).toBe("monsterZone");
    expect(state.players[0].lifePoints).toBe(7400);
    expect(state.log.some((entry) => entry.action === "damage" && entry.player === 0 && entry.detail === "600")).toBe(true);
  });

  it("modifies player life points and ends the duel at zero", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    expect(damageDuelPlayer(session.state, 1, 1500)).toBe(1500);
    expect(queryPublicState(session).players[1].lifePoints).toBe(6500);
    expect(recoverDuelPlayer(session.state, 1, 500)).toBe(500);
    expect(queryPublicState(session).players[1].lifePoints).toBe(7000);
    setDuelPlayerLifePoints(session.state, 1, 0);

    const state = queryPublicState(session);
    expect(state.players[1].lifePoints).toBe(0);
    expect(state.status).toBe("ended");
    expect(state.log.some((entry) => entry.action === "damage" && entry.detail === "1500")).toBe(true);
    expect(state.log.some((entry) => entry.action === "recover" && entry.detail === "500")).toBe(true);
    expect(state.log.some((entry) => entry.action === "setLifePoints" && entry.detail === "0")).toBe(true);
  });
});
