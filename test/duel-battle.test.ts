import { describe, expect, it } from "vitest";
import {
  applyResponse,
  canDuelCardAttack,
  createDuel,
  changeDuelBattleDamage,
  damageDuelPlayer,
  declareDuelAttack,
  flipSummonDuelCard,
  getGroupedDuelLegalActions,
  getDuelAttackTargets,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  negateDuelAttack,
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
    applyAndAssert(session, battle!);
    expect(canDuelCardAttack(session.state, attacker!.uid)).toBe(true);
    expect(getDuelAttackTargets(session.state, attacker!.uid)).toHaveLength(0);

    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid);
    expect(attack).toBeTruthy();
    const attackResult = applyAndAssert(session, attack!);

    expect(attackResult.state.players[1].lifePoints).toBe(8000);
    passAttackResponses(session);
    expect(queryPublicState(session).players[1].lifePoints).toBe(6200);
    expect(session.state.battleDamage[1]).toBe(1800);
    expect(attackResult.state.attacksDeclared).toContain(attacker!.uid);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid)).toBe(false);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.attacksDeclared).toContain(attacker!.uid);
  });

  it("uses explicit battle windows before battleStep when choosing battle legal actions", () => {
    const session = createDuel({ seed: 51, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid)!);

    session.state.battleStep = "attack";
    session.state.battleWindow = {
      id: session.state.actionWindowId,
      kind: "startDamageStep",
      step: "damage",
      attackerUid: attacker!.uid,
      responsePlayer: 1,
      attackNegated: false,
    };

    const legal = getDuelLegalActions(session, 1);
    expect(legal.some((action) => action.type === "passDamage")).toBe(true);
    expect(legal.some((action) => action.type === "passAttack")).toBe(false);
  });

  it("lets face-down non-monster cards in the monster zone be attacked", () => {
    const localCards = [
      ...cards,
      { code: "900", name: "Hidden Spell Decoy", kind: "spell" as const, typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 32, startingHandSize: 1, cardReader: createCardReader(localCards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["900"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const decoy = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "900");
    expect(attacker).toBeTruthy();
    expect(decoy).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    const movedDecoy = moveDuelCard(session.state, decoy!.uid, "monsterZone", 1);
    movedDecoy.position = "faceDownDefense";
    movedDecoy.faceUp = false;

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    expect(getDuelAttackTargets(session.state, attacker!.uid).map((card) => card.uid)).toEqual([decoy!.uid]);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "declareAttack" && action.targetUid === decoy!.uid)).toBe(true);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.targetUid === decoy!.uid)!);
    passAttackResponses(session);

    expect(session.state.cards.find((card) => card.uid === decoy!.uid)).toMatchObject({ location: "graveyard" });
  });

  it("omits monsters protected from battle targeting", () => {
    const session = createDuel({ seed: 33, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "100"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const targets = queryPublicState(session).cards.filter((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(targets).toHaveLength(2);
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    const protectedTarget = specialSummonDuelCard(session.state, targets[0]!.uid, 1);
    const legalTarget = specialSummonDuelCard(session.state, targets[1]!.uid, 1);

    registerEffect(session, {
      id: "cannot-be-battle-target",
      sourceUid: protectedTarget.uid,
      controller: 1,
      event: "continuous",
      code: 70,
      range: ["monsterZone"],
      operation() {},
    });

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    expect(getDuelAttackTargets(session.state, attacker!.uid).map((card) => card.uid)).toEqual([legalTarget.uid]);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "declareAttack" && action.targetUid === protectedTarget.uid)).toBe(false);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "declareAttack" && action.targetUid === legalTarget.uid)).toBe(true);
    expect(applyResponse(session, { type: "declareAttack", player: 0, attackerUid: attacker!.uid, targetUid: protectedTarget.uid, label: "Attack protected" }).ok).toBe(false);
  });

  it("omits monsters blocked by battle target selection effects", () => {
    const session = createDuel({ seed: 34, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "100"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const monsters = queryPublicState(session).cards.filter((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(monsters).toHaveLength(3);
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    const source = specialSummonDuelCard(session.state, monsters[0]!.uid, 1);
    const blockedTarget = specialSummonDuelCard(session.state, monsters[1]!.uid, 1);
    const legalTarget = specialSummonDuelCard(session.state, monsters[2]!.uid, 1);

    registerEffect(session, {
      id: "cannot-select-battle-target",
      sourceUid: source.uid,
      controller: 1,
      event: "continuous",
      code: 332,
      range: ["monsterZone"],
      targetRange: [0, 0x04],
      valueCardPredicate: (_ctx, card) => card.uid === blockedTarget.uid,
      operation() {},
    });

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    expect(getDuelAttackTargets(session.state, attacker!.uid).map((card) => card.uid)).toEqual([source.uid, legalTarget.uid]);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "declareAttack" && action.targetUid === blockedTarget.uid)).toBe(false);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "declareAttack" && action.targetUid === legalTarget.uid)).toBe(true);
  });

  it("offers quick effects during the attack response window before battle resolves", () => {
    const session = createDuel({ seed: 31, startingHandSize: 2, cardReader: createCardReader(cards) });
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
      id: "attack-window-quick",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.log("Attack window quick resolved");
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
    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "attack-window-quick");
    expect(quick).toBeTruthy();
    applyAndAssert(session, quick!);

    expect(session.state.pendingBattle).toBeDefined();
    expect(session.state.battleStep).toBe("attack");
    expect(session.state.waitingFor).toBe(1);
    expect(session.state.players[1].lifePoints).toBe(8000);
    expect(session.state.log.some((entry) => entry.detail === "Attack window quick resolved")).toBe(true);
    passAttackResponses(session);
    expect(queryPublicState(session).players[1].lifePoints).toBe(6200);
  });

  it("lets quick effects negate attacks from the attack response window", () => {
    const session = createDuel({ seed: 32, startingHandSize: 2, cardReader: createCardReader(cards) });
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
      id: "attack-window-negate",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.log(`Negate attack quick ${negateDuelAttack(session.state)}`);
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
    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "attack-window-negate");
    expect(quick).toBeTruthy();
    applyAndAssert(session, quick!);

    expect(session.state.pendingBattle).toBeUndefined();
    expect(session.state.currentAttack).toBeUndefined();
    expect(session.state.attackPasses).toEqual([]);
    expect(session.state.players[1].lifePoints).toBe(8000);
    expect(session.state.log.some((entry) => entry.detail === "Negate attack quick true")).toBe(true);
    expect(session.state.log.some((entry) => entry.action === "attack" && entry.detail === "Negated attack")).toBe(true);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "passAttack")).toBe(false);
  });

  it("offers quick effects during the damage response window before battle resolves", () => {
    const session = createDuel({ seed: 35, startingHandSize: 2, cardReader: createCardReader(cards) });
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
      id: "damage-step-quick",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      oncePerTurn: true,
      property: 0x4000,
      operation(ctx) {
        ctx.log("Damage step quick resolved");
      },
    });
    registerEffect(session, {
      id: "damage-calculation-quick",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      oncePerTurn: true,
      property: 0x8000,
      operation(ctx) {
        ctx.log("Damage calculation quick resolved");
      },
    });
    registerEffect(session, {
      id: "damage-window-unflagged-quick",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Unflagged damage quick resolved");
      },
    });

    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    applyAndAssert(session, battle!);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid);
    expect(attack).toBeTruthy();
    applyAndAssert(session, attack!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passAttack")!);

    expect(session.state.battleStep).toBe("damage");
    expect(session.state.players[1].lifePoints).toBe(8000);
    const quick = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "damage-step-quick");
    expect(quick).toBeUndefined();
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "damage-window-unflagged-quick")).toBe(false);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect" && action.effectId === "damage-calculation-quick")).toBe(false);
    const turnPlayerQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "damage-step-quick");
    expect(turnPlayerQuick).toBeTruthy();
    applyAndAssert(session, turnPlayerQuick!);
    expect(session.state.pendingBattle).toBeDefined();
    expect(session.state.battleStep).toBe("damage");
    expect(session.state.log.some((entry) => entry.detail === "Damage step quick resolved")).toBe(true);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passDamage")!);
    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passDamage")!);
    expect(session.state.battleStep).toBe("damageCalculation");
    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(getDuelLegalActions(session, 1).some((action) => action.type === "activateEffect" && action.effectId === "damage-step-quick")).toBe(false);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    const calculationQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "damage-calculation-quick");
    expect(calculationQuick).toBeTruthy();
    applyAndAssert(session, calculationQuick!);
    expect(session.state.battleStep).toBe("damageCalculation");
    expect(session.state.log.some((entry) => entry.detail === "Damage calculation quick resolved")).toBe(true);
    passAttackResponses(session);
    expect(queryPublicState(session).players[1].lifePoints).toBe(6200);
  });

  it("applies battle damage overrides from damage calculation effects", () => {
    const session = createDuel({ seed: 36, startingHandSize: 2, cardReader: createCardReader(cards) });
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
      id: "damage-calculation-override",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      oncePerTurn: true,
      property: 0x8000,
      operation(ctx) {
        changeDuelBattleDamage(session.state, 1, 600);
        ctx.log("Damage calculation override resolved");
      },
    });

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passDamage")!);
    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passDamage")!);
    expect(session.state.battleStep).toBe("damageCalculation");
    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");

    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "damage-calculation-override");
    expect(quick).toBeTruthy();
    applyAndAssert(session, quick!);
    expect(session.state.battleDamage[1]).toBe(600);
    expect(session.state.pendingBattle?.battleDamageOverrides).toEqual({ 1: 600 });

    passAttackResponses(session);
    expect(queryPublicState(session).players[1].lifePoints).toBe(7400);
    expect(session.state.battleDamage[1]).toBe(600);
    expect(session.state.log.some((entry) => entry.detail === "Damage calculation override resolved")).toBe(true);
  });

  it("queues triggers at after damage calculation and end of damage step", () => {
    const session = createDuel({ seed: 37, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "301"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const afterSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const endSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    expect(attacker).toBeTruthy();
    expect(afterSource).toBeTruthy();
    expect(endSource).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    registerEffect(session, {
      id: "after-damage-trigger",
      sourceUid: afterSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "afterDamageCalculation",
      range: ["hand"],
      operation(ctx) {
        ctx.log("After damage calculation trigger resolved");
      },
    });
    registerEffect(session, {
      id: "end-damage-step-trigger",
      sourceUid: endSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "damageStepEnded",
      range: ["hand"],
      operation(ctx) {
        ctx.log("End damage step trigger resolved");
      },
    });

    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && !action.targetUid)!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passAttack")!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passDamage")!);
    expect(session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passDamage")!);
    expect(session.state.battleWindow?.kind).toBe("duringDamageCalculation");

    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passDamage")!);
    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["afterDamageCalculation"]);
    const afterTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "after-damage-trigger");
    expect(afterTrigger).toBeTruthy();
    applyAndAssert(session, afterTrigger!);
    expect(passCurrentChainIfPending(session)).toBe(true);
    expect(session.state.log.some((entry) => entry.detail === "After damage calculation trigger resolved")).toBe(true);

    applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passDamage")!);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "passDamage")!);
    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["damageStepEnded"]);
    const endTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "end-damage-step-trigger");
    expect(endTrigger).toBeTruthy();
    applyAndAssert(session, endTrigger!);
    expect(passCurrentChainIfPending(session)).toBe(true);
    expect(session.state.log.some((entry) => entry.detail === "End damage step trigger resolved")).toBe(true);
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
    applyAndAssert(session, battle!);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid);
    expect(attack).toBeTruthy();
    applyAndAssert(session, attack!);
    passAttackResponses(session);

    expect(session.state.activityCounts[0]).toEqual({ summon: 2, normalSummon: 0, specialSummon: 1, flipSummon: 1, attack: 1 });
    expect(queryPublicState(session).activityCounts[0]).toEqual(session.state.activityCounts[0]);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.activityCounts[0]).toEqual(session.state.activityCounts[0]);

    const end = getDuelLegalActions(session, 0).find((action) => action.type === "endTurn");
    expect(end).toBeTruthy();
    applyAndAssert(session, end!);
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
    applyAndAssert(session, battle!);
    expect(getDuelAttackTargets(session.state, attacker!.uid).map((card) => card.uid)).toEqual([target!.uid]);

    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.targetUid === target!.uid);
    expect(attack).toBeTruthy();
    const result = applyAndAssert(session, attack!);

    expect(result.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("monsterZone");
    passAttackResponses(session);
    const state = queryPublicState(session);
    expect(state.cards.find((card) => card.uid === attacker!.uid)?.location).toBe("monsterZone");
    expect(state.cards.find((card) => card.uid === target!.uid)?.location).toBe("graveyard");
    expect(state.players[1].lifePoints).toBe(7100);
    expect(session.state.battleDamage[1]).toBe(900);
    expect(state.log.some((entry) => entry.action === "destroy" && entry.card === "Opponent Monster")).toBe(true);
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
    applyAndAssert(session, battle!);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.targetUid === target!.uid);
    expect(attack).toBeTruthy();
    const result = applyAndAssert(session, attack!);

    expect(result.state.cards.find((card) => card.uid === target!.uid)?.location).toBe("monsterZone");
    expect(result.state.players[1].lifePoints).toBe(8000);
    passAttackResponses(session);
    const state = queryPublicState(session);
    expect(state.players[1].lifePoints).toBe(7100);
    expect(state.pendingTriggers).toHaveLength(0);
    expect(state.log.some((entry) => entry.action === "destroyPrevented" && entry.card === "Opponent Monster")).toBe(true);
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
    applyAndAssert(session, battle!);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.targetUid === target!.uid);
    expect(attack).toBeTruthy();
    const attackResult = applyAndAssert(session, attack!);

    expect(attackResult.state.pendingTriggers).toHaveLength(0);
    passAttackResponses(session);
    expect(session.state.pendingTriggers).toHaveLength(1);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "battleDestroyed", eventCardUid: target!.uid });

    const trigger = getDuelLegalActions(session, 1).find((action) => action.type === "activateTrigger" && action.effectId === "battle-destroyed-trigger");
    expect(trigger).toBeTruthy();
    const result = applyAndAssert(session, trigger!);

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
    applyAndAssert(session, battle!);
    declareDuelAttack(session.state, 0, attacker!.uid, target!.uid);
    passAttackResponses(session);

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

function passAttackResponses(session: ReturnType<typeof createDuel>): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((action) => action.type === (session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack"));
    expect(pass).toBeTruthy();
    applyAndAssert(session, pass!);
  }
}

function legalEffectIds(session: ReturnType<typeof createDuel>, player: 0 | 1): string[] {
  return getDuelLegalActions(session, player)
    .filter((action) => action.type === "activateEffect")
    .map((action) => action.effectId);
}

function passCurrentChainIfPending(session: ReturnType<typeof createDuel>): boolean {
  if (!session.state.chain.length) return true;
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const pass = getDuelLegalActions(session, player).find((action) => action.type === "passChain");
  expect(pass).toBeTruthy();
  return applyAndAssert(session, pass!).ok;
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
