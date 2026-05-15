import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  specialSummonDuelCard,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { duelBattlefieldActionView, visibleDuelBattlefieldActions } from "../src/playtest-app/duel-battlefield-actions.js";
import { cards } from "./full-duel-engine-fixtures.js";
import type { DuelAction, DuelSession, PlayerId } from "#duel/types.js";

describe("duel battlefield action view", () => {
  it("drives a direct battle fixture through visible battlefield actions", () => {
    const session = createDuel({ seed: 991, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    specialSummonDuelCard(session.state, attacker!.uid, 0);

    const battle = visibleAction(session, 0, (action) => action.type === "changePhase" && action.phase === "battle");
    expect(battle).toMatchObject({ type: "changePhase", phase: "battle", windowKind: "open" });
    applyVisible(session, battle);

    const attackView = visibleView(session, 0);
    expect(attackView.byUid.get(attacker!.uid)).toContainEqual(expect.objectContaining({ type: "declareAttack", attackerUid: attacker!.uid }));
    const attack = visibleDuelBattlefieldActions(attackView).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.directAttack === true,
    );
    expect(attack).toBeDefined();
    applyVisible(session, attack!);

    const opponentPass = visibleAction(session, 1, (action) => action.type === "passAttack");
    expect(visibleView(session, 1).orphanGroups).toContainEqual(expect.objectContaining({ label: "Pass", actions: [opponentPass] }));
    applyVisible(session, opponentPass);

    passVisibleBattleWindows(session);

    const state = queryPublicState(session);
    expect(state.players[1].lifePoints).toBe(6200);
    expect(state.attacksDeclared).toContain(attacker!.uid);
  });
});

function visibleView(session: DuelSession, player: PlayerId) {
  return duelBattlefieldActionView(
    queryPublicState(session),
    player,
    getDuelLegalActions(session, player),
    getGroupedDuelLegalActions(session, player),
  );
}

function visibleAction(session: DuelSession, player: PlayerId, predicate: (action: DuelAction) => boolean): DuelAction {
  const action = visibleDuelBattlefieldActions(visibleView(session, player)).find(predicate);
  expect(action).toBeDefined();
  return action!;
}

function applyVisible(session: DuelSession, action: DuelAction): void {
  const result = applyResponse(session, action);
  expect(result.ok).toBe(true);
}

function passVisibleBattleWindows(session: DuelSession): void {
  for (let i = 0; i < 12; i += 1) {
    const state = queryPublicState(session);
    if (state.players[1].lifePoints < 8000) return;
    const player = state.waitingFor;
    expect(player).toBeDefined();
    const view = visibleView(session, player!);
    const action = visibleDuelBattlefieldActions(view).find((candidate) => candidate.type === "passAttack" || candidate.type === "passDamage");
    expect(action).toBeDefined();
    expect(view.orphanGroups.some((group) => group.actions.includes(action!))).toBe(true);
    applyVisible(session, action!);
  }
  expect(queryPublicState(session).players[1].lifePoints).toBeLessThan(8000);
}
