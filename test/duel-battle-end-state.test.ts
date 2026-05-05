import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  declareDuelAttack,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  setDuelPlayerLifePoints,
  specialSummonDuelCard,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel battle end state", () => {
  it("clears pending battle windows when LP loss ends the duel", () => {
    const session = createDuel({ seed: 119, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attacker = session.state.cards.find((card) => card.code === "100");
    const target = session.state.cards.find((card) => card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    specialSummonDuelCard(session.state, target!.uid, 1);
    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    declareDuelAttack(session.state, 0, attacker!.uid, target!.uid);
    session.state.battleDamage = { 0: 0, 1: 1200 };
    session.state.attackCostPaid = 1;

    setDuelPlayerLifePoints(session.state, 1, 0);

    const state = queryPublicState(session);
    expect(state.status).toBe("ended");
    expect(state.waitingFor).toBeUndefined();
    expect(state.battleStep).toBeUndefined();
    expect(state.battleWindow).toBeUndefined();
    expect(session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(session.state.attackCostPaid).toBe(0);
    expect(state.attackPasses).toEqual([]);
    expect(state.damagePasses).toEqual([]);
  });

  it("does not reopen trigger windows after lethal battle damage", () => {
    const localCards = [
      ...cards,
      { code: "910", name: "Lethal Attacker", kind: "monster" as const, attack: 9000 },
      { code: "920", name: "Battle Damage Watcher", kind: "monster" as const },
    ];
    const session = createDuel({ seed: 120, startingHandSize: 2, cardReader: createCardReader(localCards) });
    loadDecks(session, {
      0: { main: ["910"] },
      1: { main: ["920"] },
    });
    startDuel(session);
    const attacker = session.state.cards.find((card) => card.code === "910");
    const watcher = session.state.cards.find((card) => card.code === "920");
    expect(attacker).toBeTruthy();
    expect(watcher).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    registerEffect(session, {
      id: "lethal-battle-damage-watcher",
      sourceUid: watcher!.uid,
      controller: 1,
      event: "trigger",
      triggerEvent: "battleDamageDealt",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Lethal battle damage watcher resolved");
      },
    });
    const battle = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toBeTruthy();
    expect(applyResponse(session, battle!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid);
    expect(attack).toBeTruthy();
    expect(applyResponse(session, attack!).ok).toBe(true);

    passAttackResponses(session);

    const state = queryPublicState(session);
    expect(state.status).toBe("ended");
    expect(state.waitingFor).toBeUndefined();
    expect(state.pendingTriggers).toEqual([]);
    expect(state.battleWindow).toBeUndefined();
  });
});

function passAttackResponses(session: ReturnType<typeof createDuel>): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((action) => action.type === (session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack"));
    expect(pass).toBeTruthy();
    expect(applyResponse(session, pass!).ok).toBe(true);
  }
}
