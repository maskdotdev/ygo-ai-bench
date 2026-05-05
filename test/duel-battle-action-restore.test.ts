import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, restoreDuel, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { moveDuelCard } from "#duel/card-state.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("battle action restore", () => {
  it("restores direct attack legal actions and applies the restored action", () => {
    const session = createBattleSession(["100"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && !candidate.targetUid);
    expect(action).toBeDefined();

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid });
    expect(restored.state.battleWindow).toMatchObject({ kind: "attackNegationResponse", responsePlayer: 1 });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  });

  it("restores targeted attack legal actions and applies the restored action", () => {
    const session = createBattleSession(["100"], ["400"]);
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const target = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(attacker).toBeTruthy();
    expect(target).toBeTruthy();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    expect(applyResponse(session, getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!).ok).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "declareAttack" && candidate.attackerUid === attacker!.uid && candidate.targetUid === target!.uid);
    expect(action).toBeDefined();

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(restored.state.currentAttack).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.pendingBattle).toMatchObject({ attackerUid: attacker!.uid, targetUid: target!.uid });
    expect(restored.state.battleWindow).toMatchObject({ kind: "attackNegationResponse", responsePlayer: 1 });
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  });
});

function createBattleSession(playerDeck: string[], opponentDeck: string[]) {
  const session = createDuel({ seed: 1, startingHandSize: Math.max(playerDeck.length, opponentDeck.length), cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: playerDeck },
    1: { main: opponentDeck },
  });
  startDuel(session);
  return session;
}
