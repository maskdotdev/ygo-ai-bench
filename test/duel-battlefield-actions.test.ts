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
import { runDuelBattlefieldScript } from "../src/playtest-app/duel-battlefield-script.js";
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

  it("runs fixture-style scripts through the visible battlefield action surface", () => {
    const session = directBattleSession();
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "monsterZone" && card.code === "100");
    expect(attacker).toBeDefined();

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "changePhase", labelIncludes: "battle" },
      { player: 0, type: "declareAttack", uid: attacker!.uid },
      { player: 1, type: "passAttack", groupLabel: "Attack Response" },
      { player: 0, type: "passAttack", groupLabel: "Attack Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
      { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
    ]);

    expect(result.ok).toBe(true);
    expect(result.failedStep).toBeUndefined();
    expect(result.state.players[1].lifePoints).toBe(6200);
    expect(result.state.attacksDeclared).toContain(attacker!.uid);
  });

  it("matches visible scripts by exact window and action fields", () => {
    const session = directBattleSession();
    const battle = visibleAction(session, 0, (action) => action.type === "changePhase" && action.phase === "battle");
    const windowId = battle.windowId;
    const windowToken = battle.windowToken;
    if (windowId === undefined || windowToken === undefined) throw new Error("Expected visible battle action to be stamped with a window");

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "changePhase", phase: "battle", windowId, windowKind: "open", windowToken },
    ]);

    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("battle");
  });

  it("matches prompt responses by exact prompt id and option", () => {
    const session = directBattleSession();
    session.state.prompt = { id: "battlefield-option-prompt", type: "selectOption", player: 1, options: [2, 4], descriptions: [200, 400], returnTo: 0 };
    session.state.waitingFor = 1;

    const result = runDuelBattlefieldScript(session, [
      { player: 1, type: "selectOption", promptId: "battlefield-option-prompt", option: 4, windowKind: "prompt" },
    ]);

    expect(result.ok).toBe(true);
    expect(result.state.prompt).toBeUndefined();
    expect(result.state.waitingFor).toBe(0);
    expect(result.state.log).toContainEqual(expect.objectContaining({ action: "selectOption", detail: "Selected option 4" }));
  });

  it("matches visible summon scripts by exact material selection", () => {
    const session = createDuel({ seed: 992, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const first = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const second = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(fusion).toBeDefined();
    specialSummonDuelCard(session.state, first!.uid, 0);
    specialSummonDuelCard(session.state, second!.uid, 0);

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "fusionSummon", uid: fusion!.uid, materialUids: [second!.uid, first!.uid] },
    ]);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(result.state.cards.find((card) => card.uid === first!.uid)).toMatchObject({ location: "graveyard" });
    expect(result.state.cards.find((card) => card.uid === second!.uid)).toMatchObject({ location: "graveyard" });
  });

  it("reports material selector fields when visible summon scripts diverge", () => {
    const session = createDuel({ seed: 993, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const first = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const second = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const fusion = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "900");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(fusion).toBeDefined();
    specialSummonDuelCard(session.state, first!.uid, 0);
    specialSummonDuelCard(session.state, second!.uid, 0);

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "fusionSummon", uid: fusion!.uid, materialUids: [first!.uid] },
    ]);

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(0);
    expect(result.failure).toBe(`No visible battlefield action matched player=0 type=fusionSummon uid=${fusion!.uid} materialUids=${first!.uid}`);
    expect(result.visibleActions).toContainEqual(expect.objectContaining({ type: "fusionSummon", uid: fusion!.uid, materialUids: expect.arrayContaining([first!.uid, second!.uid]) }));
  });

  it("reports prompt views when a visible prompt script diverges", () => {
    const session = directBattleSession();
    session.state.prompt = { id: "battlefield-diverge-prompt", type: "selectOption", player: 1, options: [2, 4], descriptions: [200, 400], returnTo: 0 };
    session.state.waitingFor = 1;

    const result = runDuelBattlefieldScript(session, [
      { player: 1, type: "selectOption", promptId: "battlefield-diverge-prompt", option: 6, windowKind: "prompt" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.prompt).toMatchObject({ label: "Option Prompt", detail: "P2 · Prompt battlefield-diverge-prompt · returns P1 · options 2, 4 · text 200, 400" });
    expect(result.prompt?.groups.flatMap((group) => group.actions)).toEqual(result.visibleActions);
    expect(result.visibleActions).toContainEqual(expect.objectContaining({ type: "selectOption", promptId: "battlefield-diverge-prompt", option: 4 }));
  });

  it("reports visible group labels when a battlefield script diverges", () => {
    const session = directBattleSession();
    const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "monsterZone" && card.code === "100");
    expect(attacker).toBeDefined();

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "changePhase", labelIncludes: "battle" },
      { player: 0, type: "declareAttack", uid: attacker!.uid },
      { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(2);
    expect(result.failure).toBe("No visible battlefield action matched player=1 type=passDamage groupLabel=Damage Step Response");
    expect(result.visibleGroups).toContainEqual(expect.objectContaining({ label: "Attack Response" }));
    expect(result.visibleActions).toContainEqual(expect.objectContaining({ type: "passAttack" }));
  });

  it("reports exact selector fields when a visible script diverges", () => {
    const session = directBattleSession();
    const battle = visibleAction(session, 0, (action) => action.type === "changePhase" && action.phase === "battle");
    const wrongWindowId = (battle.windowId ?? 0) + 1;

    const result = runDuelBattlefieldScript(session, [
      { player: 0, type: "changePhase", phase: "battle", windowId: wrongWindowId, windowKind: "open", occurrence: 0 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe(0);
    expect(result.failure).toBe(`No visible battlefield action matched player=0 type=changePhase windowId=${wrongWindowId} windowKind=open phase=battle occurrence=0`);
    expect(result.visibleActions).toContainEqual(expect.objectContaining({ type: "changePhase", phase: "battle", windowId: battle.windowId, windowKind: "open" }));
  });
});

function directBattleSession(): DuelSession {
  const session = createDuel({ seed: 991, startingHandSize: 1, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100"] },
    1: { main: ["400"] },
  });
  startDuel(session);

  const attacker = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
  expect(attacker).toBeDefined();
  specialSummonDuelCard(session.state, attacker!.uid, 0);
  return session;
}

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
