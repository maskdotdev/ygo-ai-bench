import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, restoreDuel, serializeDuel, sendDuelCardToGraveyard, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

function setupOneCardDuel(seed: number) {
  const session = createDuel({ seed, startingHandSize: 1, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100"] },
    1: { main: ["400"] },
  });
  startDuel(session);
  return session;
}

describe("duel action windows", () => {
  it("increments actionWindowId after successful responses", () => {
    const session = setupOneCardDuel(109);
    expect(session.state.actionWindowId).toBe(0);

    session.state.prompt = { id: "window-success", type: "selectYesNo", player: 0 };
    session.state.waitingFor = 0;
    const yes = getDuelLegalActions(session, 0).find((action) => action.type === "selectYesNo" && action.yes);
    expect(yes).toBeDefined();
    expect(yes?.windowId).toBe(0);
    expect(yes?.windowKind).toBe("prompt");
    expect(applyResponse(session, yes!).ok).toBe(true);

    expect(session.state.actionWindowId).toBe(1);
    const nextAction = getDuelLegalActions(session, 0)[0];
    expect(nextAction?.windowId).toBe(1);
    expect(nextAction?.windowKind).toBe("open");
  });

  it("does not increment actionWindowId after illegal responses", () => {
    const session = setupOneCardDuel(110);
    const staleResponse = { type: "passChain" as const, player: 0 as const, label: "Pass", windowId: 0 };
    const result = applyResponse(session, staleResponse);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Response is not currently legal");
    expect(session.state.actionWindowId).toBe(0);
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
    expect(applyResponse(session, starterAction!).ok).toBe(true);

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
    expect(applyResponse(session, attack!).ok).toBe(true);

    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passAttack");
    expect(pass).toBeDefined();
    expect(pass?.windowKind).toBe("battle");
  });
});
