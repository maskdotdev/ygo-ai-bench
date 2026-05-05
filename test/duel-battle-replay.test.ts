import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel battle replay", () => {
  it("opens a replay decision when the attack target leaves before damage", () => {
    const session = createDuel({ seed: 33, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    expect(quickSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    registerEffect(session, {
      id: "remove-target-before-damage",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.moveCard(target!.uid, "graveyard", 1);
        ctx.log("Attack target left before damage");
      },
    });

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    applyAndAssert(session, battle!);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid);
    expect(attack).toBeTruthy();
    applyAndAssert(session, attack!);

    const opponentPass = getDuelLegalActions(session, 1).find((action) => action.type === "passAttack");
    expect(opponentPass).toBeTruthy();
    applyAndAssert(session, opponentPass!);
    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "remove-target-before-damage");
    expect(quick).toBeTruthy();
    applyAndAssert(session, quick!);
    passUntilReplayDecision(session);

    expect(session.state.pendingBattle).toBeDefined();
    expect(session.state.currentAttack).toBeDefined();
    expect(session.state.battleWindow).toMatchObject({
      kind: "replayDecision",
      step: "attack",
      attackerUid: attacker!.uid,
      responsePlayer: 0,
    });
    const replayActions = getDuelLegalActions(session, 0);
    expect(replayActions.some((action) => action.type === "replayAttack" && action.attackerUid === attacker!.uid && action.targetUid === undefined)).toBe(true);
    const cancel = replayActions.find((action) => action.type === "cancelAttack" && action.attackerUid === attacker!.uid);
    expect(cancel).toBeTruthy();
    applyAndAssert(session, cancel!);

    expect(session.state.pendingBattle).toBeUndefined();
    expect(session.state.currentAttack).toBeUndefined();
    expect(session.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("graveyard");
    expect(session.state.cards.find((card) => card.uid === attacker!.uid)?.location).toBe("monsterZone");
    expect(session.state.players[1].lifePoints).toBe(8000);
    expect(session.state.log.some((entry) => entry.detail === "Attack target left before damage")).toBe(true);
    expect(session.state.log.some((entry) => entry.detail === "Replay decision pending")).toBe(true);
    expect(session.state.log.some((entry) => entry.detail === "Canceled replay attack")).toBe(true);
  });

  it("replays directly after the attack target leaves and no monsters remain", () => {
    const session = createDuel({ seed: 53, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    expect(quickSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    registerEffect(session, {
      id: "remove-target-before-direct-replay",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.moveCard(target!.uid, "graveyard", 1);
      },
    });

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === target!.uid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "remove-target-before-direct-replay")!);
    passUntilReplayDecision(session);

    const replay = getDuelLegalActions(session, 0).find((action) => action.type === "replayAttack" && action.attackerUid === attacker!.uid && action.targetUid === undefined);
    expect(replay).toBeTruthy();
    applyAndAssert(session, replay!);
    passAttackResponses(session);

    expect(session.state.pendingBattle).toBeUndefined();
    expect(session.state.players[1].lifePoints).toBe(6200);
    expect(session.state.log.some((entry) => entry.detail === "Replayed direct attack")).toBe(true);
  });

  it("opens a replay decision when the opponent monster count changes before damage", () => {
    const session = createDuel({ seed: 54, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const targets = queryPublicState(session).cards.filter((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(targets).toHaveLength(3);
    expect(quickSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    const originalTarget = moveDuelCard(session.state, targets[0]!.uid, "monsterZone", 1);
    originalTarget.position = "faceUpAttack";
    registerEffect(session, {
      id: "add-target-before-damage",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        const added = ctx.moveCard(targets[1]!.uid, "monsterZone", 1);
        added.position = "faceUpAttack";
        ctx.log("Attack target count changed before damage");
      },
    });

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === originalTarget.uid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "add-target-before-damage")!);
    passUntilReplayDecision(session);

    expect(session.state.battleWindow?.kind).toBe("replayDecision");
    const replayActions = getDuelLegalActions(session, 0);
    expect(replayActions.some((action) => action.type === "cancelAttack" && action.attackerUid === attacker!.uid)).toBe(true);
    expect(replayActions.some((action) => action.type === "replayAttack" && action.attackerUid === attacker!.uid && action.targetUid === originalTarget.uid)).toBe(true);
    expect(replayActions.some((action) => action.type === "replayAttack" && action.attackerUid === attacker!.uid && action.targetUid === targets[1]!.uid)).toBe(true);
    const replayNewTarget = replayActions.find((action) => action.type === "replayAttack" && action.targetUid === targets[1]!.uid);
    expect(replayNewTarget).toBeTruthy();
    applyAndAssert(session, replayNewTarget!);
    passAttackResponses(session);

    expect(session.state.pendingBattle).toBeUndefined();
    expect(session.state.cards.find((card) => card.uid === originalTarget.uid)?.location).toBe("monsterZone");
    expect(session.state.cards.find((card) => card.uid === targets[1]!.uid)?.location).toBe("graveyard");
    expect(session.state.players[1].lifePoints).toBe(7700);
    expect(session.state.log.some((entry) => entry.detail === "Attack target count changed before damage")).toBe(true);
    expect(session.state.log.some((entry) => entry.detail === `Replayed attack on ${targets[1]!.name}`)).toBe(true);
  });

  it("skips battle resolution when the attacker leaves before damage", () => {
    const session = createDuel({ seed: 34, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(attacker).toBeTruthy();
    expect(quickSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    registerEffect(session, {
      id: "remove-attacker-before-damage",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.moveCard(attacker!.uid, "graveyard", 0);
        ctx.log("Attacker left before damage");
      },
    });

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    applyAndAssert(session, battle!);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid);
    expect(attack).toBeTruthy();
    applyAndAssert(session, attack!);

    const opponentPass = getDuelLegalActions(session, 1).find((action) => action.type === "passAttack");
    expect(opponentPass).toBeTruthy();
    applyAndAssert(session, opponentPass!);
    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "remove-attacker-before-damage");
    expect(quick).toBeTruthy();
    applyAndAssert(session, quick!);
    passAttackResponses(session);

    expect(session.state.pendingBattle).toBeUndefined();
    expect(session.state.currentAttack).toBeUndefined();
    expect(session.state.cards.find((card) => card.uid === attacker!.uid)?.location).toBe("graveyard");
    expect(session.state.players[1].lifePoints).toBe(8000);
    expect(session.state.log.some((entry) => entry.detail === "Attacker left before damage")).toBe(true);
  });
});

function passAttackResponses(session: ReturnType<typeof createDuel>): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((action) => action.type === (session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack"));
    expect(pass).toBeTruthy();
    applyAndAssert(session, pass!);
  }
}

function passUntilReplayDecision(session: ReturnType<typeof createDuel>): void {
  while (session.state.pendingBattle && session.state.battleWindow?.kind !== "replayDecision") {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((action) => action.type === (session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack"));
    expect(pass).toBeTruthy();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
