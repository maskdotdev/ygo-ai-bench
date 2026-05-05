import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, sendDuelCardToGraveyard, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { stampDuelActions } from "#duel/prompt-response.js";
import type { DuelAction } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";
import { registerBucketTrigger, setupTriggerBucketFixture } from "./duel-trigger-fixtures.js";

function setupOneCardDuel(seed: number) {
  const session = createDuel({ seed, startingHandSize: 1, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100"] },
    1: { main: ["400"] },
  });
  startDuel(session);
  return session;
}

function expectLegalActionsMatchPublicWindow(session: ReturnType<typeof setupOneCardDuel>, player: 0 | 1): void {
  const publicState = queryPublicState(session);
  const actions = getDuelLegalActions(session, player);
  const groups = getGroupedDuelLegalActions(session, player);
  expect(publicState.actionWindowId).toBe(session.state.actionWindowId);
  for (const action of actions) {
    expect(action.windowId).toBe(publicState.actionWindowId);
    expect(action.windowKind).toBe(publicState.windowKind);
  }
  for (const group of groups) {
    expect(group.windowId).toBe(publicState.actionWindowId);
    expect(group.windowKind).toBe(publicState.windowKind);
  }
}

function expectResultActionsMatchResultState(result: ReturnType<typeof applyResponse>): void {
  for (const action of result.legalActions) {
    expect(action.windowId).toBe(result.state.actionWindowId);
    expect(action.windowKind).toBe(result.state.windowKind);
  }
  for (const group of result.legalActionGroups) {
    expect(group.windowId).toBe(result.state.actionWindowId);
    expect(group.windowKind).toBe(result.state.windowKind);
  }
}

describe("duel action windows", () => {
  it("copies stamped action payloads away from the source action list", () => {
    const actions: DuelAction[] = [{ type: "fusionSummon", player: 0, uid: "fusion", materialUids: ["a", "b"], label: "Fusion" }];
    const stamped = stampDuelActions(actions, 2, "open");
    const stampedAction = stamped[0];
    expect(stampedAction?.type).toBe("fusionSummon");
    if (!stampedAction || stampedAction.type !== "fusionSummon") throw new Error("Expected a stamped fusion action");

    stampedAction.materialUids.push("c");
    stampedAction.label = "Mutated Fusion";

    expect(actions[0]).toEqual({ type: "fusionSummon", player: 0, uid: "fusion", materialUids: ["a", "b"], label: "Fusion" });
  });

  it("increments actionWindowId after successful responses", () => {
    const session = setupOneCardDuel(109);
    expect(session.state.actionWindowId).toBe(0);
    expectLegalActionsMatchPublicWindow(session, 0);

    session.state.prompt = { id: "window-success", type: "selectYesNo", player: 0 };
    session.state.waitingFor = 0;
    expectLegalActionsMatchPublicWindow(session, 0);
    const yes = getDuelLegalActions(session, 0).find((action) => action.type === "selectYesNo" && action.yes);
    expect(yes).toBeDefined();
    expect(yes?.windowId).toBe(0);
    expect(yes?.windowKind).toBe("prompt");
    const result = applyResponse(session, yes!);
    expect(result.ok).toBe(true);
    expect(result.state.actionWindowId).toBe(1);
    expect(result.state.windowKind).toBe("open");
    expectResultActionsMatchResultState(result);

    expect(session.state.actionWindowId).toBe(1);
    expectLegalActionsMatchPublicWindow(session, 0);
    const nextAction = getDuelLegalActions(session, 0)[0];
    expect(nextAction?.windowId).toBe(1);
    expect(nextAction?.windowKind).toBe("open");
  });

  it("keeps trigger-bucket legal action stamps aligned with public state", () => {
    const { session, summoned, turnFirst, turnSecond } = setupTriggerBucketFixture();
    registerBucketTrigger(session, "window-kind-trigger-bucket", turnFirst, 0);
    registerBucketTrigger(session, "window-kind-second-trigger-bucket", turnSecond, 0);

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon).toBeDefined();
    const result = applyResponse(session, summon!);
    expect(result.ok).toBe(true);
    expect(result.state.windowKind).toBe("triggerBucket");
    expectResultActionsMatchResultState(result);

    const publicState = queryPublicState(session);
    expect(publicState.windowKind).toBe("triggerBucket");
    expect(publicState.triggerOrderPrompt).toEqual({
      id: `${publicState.actionWindowId}:turnOptional:0`,
      type: "orderTriggers",
      player: 0,
      triggerBucket: "turnOptional",
      triggerIds: session.state.pendingTriggers.slice(0, 2).map((trigger) => trigger.id),
    });
    expectLegalActionsMatchPublicWindow(session, 0);
  });

  it("does not increment actionWindowId after illegal responses", () => {
    const session = setupOneCardDuel(110);
    const staleResponse = { type: "passChain" as const, player: 0 as const, label: "Pass", windowId: 0 };
    const result = applyResponse(session, staleResponse);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Response is not currently legal");
    expect(session.state.actionWindowId).toBe(0);
    expect(result.state.actionWindowId).toBe(0);
    expect(result.state.windowKind).toBe("open");
    expectResultActionsMatchResultState(result);
  });

  it("rejects responses stamped with the wrong window kind", () => {
    const session = setupOneCardDuel(116);
    session.state.prompt = { id: "window-kind-mismatch", type: "selectYesNo", player: 0 };
    session.state.waitingFor = 0;
    const yes = getDuelLegalActions(session, 0).find((action) => action.type === "selectYesNo" && action.yes);
    expect(yes).toBeDefined();
    expect(yes?.windowKind).toBe("prompt");

    const result = applyResponse(session, { ...yes!, windowKind: "open" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Response is not currently legal");
    expect(session.state.actionWindowId).toBe(0);
    expect(session.state.prompt).toBeDefined();
    expect(result.state.actionWindowId).toBe(0);
    expect(result.state.windowKind).toBe("prompt");
    expectResultActionsMatchResultState(result);
  });

  it("rejects responses with partial window metadata", () => {
    const session = setupOneCardDuel(117);
    session.state.prompt = { id: "window-partial-metadata", type: "selectYesNo", player: 0 };
    session.state.waitingFor = 0;
    const yes = getDuelLegalActions(session, 0).find((action) => action.type === "selectYesNo" && action.yes);
    expect(yes).toBeDefined();
    const { windowId: _windowId, ...partialResponse } = yes!;

    const result = applyResponse(session, partialResponse);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Response is not currently legal");
    expect(session.state.actionWindowId).toBe(0);
    expect(session.state.prompt).toBeDefined();
    expect(result.state.actionWindowId).toBe(0);
    expect(result.state.windowKind).toBe("prompt");
    expectResultActionsMatchResultState(result);
  });

  it("rejects responses with malformed window metadata", () => {
    const session = setupOneCardDuel(118);
    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon");
    expect(summon).toBeDefined();
    expect(summon?.windowId).toBe(0);
    expect(summon?.windowKind).toBe("open");

    const result = applyResponse(session, { ...summon!, windowId: "0" } as never);
    const unknownKind = applyResponse(session, { ...summon!, windowKind: "unknown" } as never);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Response is not currently legal");
    expect(unknownKind.ok).toBe(false);
    expect(unknownKind.error).toContain("Response is not currently legal");
    expect(session.state.actionWindowId).toBe(0);
    expect(session.state.cards.find((card) => card.uid === summon!.uid)?.location).toBe("hand");
    expect(result.state.actionWindowId).toBe(0);
    expect(result.state.windowKind).toBe("open");
    expectResultActionsMatchResultState(result);
    expect(unknownKind.state.actionWindowId).toBe(0);
    expect(unknownKind.state.windowKind).toBe("open");
    expectResultActionsMatchResultState(unknownKind);
  });

  it("restores actionWindowId after failed response rollback", () => {
    const session = createDuel({ seed: 111, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const moved = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeDefined();
    expect(moved).toBeDefined();
    registerEffect(session, {
      id: "window-rollback-failure",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, moved!.uid, ctx.player);
        throw new Error("window rollback failed");
      },
    });

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "window-rollback-failure");
    expect(action).toBeDefined();
    expect(action?.windowId).toBe(0);
    expect(action?.windowKind).toBe("open");
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("window rollback failed");
    expect(session.state.actionWindowId).toBe(0);
    expect(getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "window-rollback-failure")?.windowId).toBe(0);
    expect(result.state.actionWindowId).toBe(0);
    expect(result.state.windowKind).toBe("open");
    expectResultActionsMatchResultState(result);
  });

  it("preserves actionWindowId through snapshots and rejects stale pre-snapshot actions", () => {
    const session = setupOneCardDuel(112);
    session.state.prompt = { id: "window-snapshot", type: "selectOption", player: 0, options: [1], returnTo: 0 };
    session.state.waitingFor = 0;
    const staleOption = getDuelLegalActions(session, 0).find((action) => action.type === "selectOption");
    expect(staleOption).toBeDefined();
    expect(staleOption?.windowId).toBe(0);
    expect(staleOption?.windowKind).toBe("prompt");
    expect(applyResponse(session, staleOption!).ok).toBe(true);
    expect(session.state.actionWindowId).toBe(1);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.actionWindowId).toBe(1);
    const replay = applyResponse(restored, staleOption!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(restored.state.actionWindowId).toBe(1);
  });

  it("rejects stale open-window actions captured before snapshot restore", () => {
    const session = setupOneCardDuel(115);
    const staleSummon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon");
    expect(staleSummon).toBeDefined();
    expect(staleSummon?.windowId).toBe(0);
    expect(staleSummon?.windowKind).toBe("open");

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const battlePhase = getDuelLegalActions(restored, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase).toBeDefined();
    expect(applyResponse(restored, battlePhase!).ok).toBe(true);
    expect(restored.state.actionWindowId).toBe(1);

    const replay = applyResponse(restored, staleSummon!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(restored.state.actionWindowId).toBe(1);
  });

  it("rejects stale replay decisions captured before snapshot restore", () => {
    const session = setupOneCardDuel(119);
    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    specialSummonDuelCard(session.state, attacker!.uid, 0);
    session.state.phase = "battle";
    session.state.actionWindowId = 5;
    session.state.waitingFor = 0;
    session.state.attacksDeclared = [attacker!.uid];
    session.state.currentAttack = { attackerUid: attacker!.uid, replayTargetCount: 0, replayTargetUids: [] };
    session.state.pendingBattle = { attackerUid: attacker!.uid, replayTargetCount: 0, replayTargetUids: [] };
    session.state.battleStep = "attack";
    session.state.battleWindow = {
      id: 5,
      kind: "replayDecision",
      step: "attack",
      attackerUid: attacker!.uid,
      responsePlayer: 0,
      attackNegated: false,
    };

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const replayAttack = getDuelLegalActions(restored, 0).find((action) => action.type === "replayAttack" && action.attackerUid === attacker!.uid);
    const staleCancel = getDuelLegalActions(restored, 0).find((action) => action.type === "cancelAttack" && action.attackerUid === attacker!.uid);
    expect(replayAttack?.windowId).toBe(5);
    expect(replayAttack?.windowKind).toBe("battle");
    expect(staleCancel?.windowId).toBe(5);
    expect(staleCancel?.windowKind).toBe("battle");

    expect(applyResponse(restored, replayAttack!).ok).toBe(true);
    expect(restored.state.actionWindowId).toBe(6);
    const staleReplay = applyResponse(restored, staleCancel!);

    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    expect(restored.state.actionWindowId).toBe(6);
  });

  it("stamps chain response legal actions with their window kind", () => {
    const session = createDuel({ seed: 113, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const starter = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const responder = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    registerEffect(session, {
      id: "window-kind-chain-starter",
      sourceUid: starter!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Chain starter resolved");
      },
    });
    registerEffect(session, {
      id: "window-kind-chain-response",
      sourceUid: responder!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Chain response resolved");
      },
    });

    const starterAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "window-kind-chain-starter");
    expect(starterAction).toBeDefined();
    const result = applyResponse(session, starterAction!);
    expect(result.ok).toBe(true);
    expect(result.state.windowKind).toBe("chainResponse");
    expectResultActionsMatchResultState(result);

    expect(queryPublicState(session).windowKind).toBe("chainResponse");
    expectLegalActionsMatchPublicWindow(session, 1);
    const responses = getDuelLegalActions(session, 1);
    expect(responses.filter((action) => action.type === "activateEffect" || action.type === "passChain").map((action) => action.windowKind)).toEqual(["chainResponse", "chainResponse"]);
  });

  it("stamps battle response legal actions with their window kind", () => {
    const session = setupOneCardDuel(114);
    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeDefined();
    specialSummonDuelCard(session.state, attacker!.uid, 0);

    const battlePhase = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase).toBeDefined();
    expect(applyResponse(session, battlePhase!).ok).toBe(true);
    const attack = getDuelLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid);
    expect(attack).toBeDefined();
    const result = applyResponse(session, attack!);
    expect(result.ok).toBe(true);
    expect(result.state.windowKind).toBe("battle");
    expectResultActionsMatchResultState(result);

    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passAttack");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("battle");
    expectLegalActionsMatchPublicWindow(session, 1);
  });
});
