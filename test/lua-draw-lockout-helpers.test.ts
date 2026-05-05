import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua draw lockout helpers", () => {
  it("applies cannot-draw effects to Lua draw predicates and operations", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Draw Lock Source", kind: "monster" },
      { code: "200", name: "Blocked Draw", kind: "monster" },
    ];
    const session = createDuel({ seed: 208, startingHandSize: 0, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "deck" && card.code === "100");
    expect(source).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    registerEffect(session, {
      id: "cannot-draw",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 25,
      range: ["hand"],
      operation: () => undefined,
    });

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("can draw locked " .. tostring(Duel.IsPlayerCanDraw(0, 1)))
      Debug.Message("draw locked " .. Duel.Draw(0, 1, REASON_EFFECT))
      Debug.Message("draw operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "cannot-draw.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["can draw locked false", "draw locked 0", "draw operated 0"]);
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "deck" });
  });

  it("applies cannot-draw effects to automatic turn draws", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Opponent Draw Lock Source", kind: "monster" },
      { code: "200", name: "Blocked Turn Draw", kind: "monster" },
    ];
    const session = createDuel({ seed: 209, startingHandSize: 0, drawPerTurn: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: [] },
      1: { main: ["100", "200"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 1 && card.location === "deck" && card.code === "100");
    expect(source).toBeDefined();
    moveDuelCard(session.state, source!.uid, "hand", 1);
    registerEffect(session, {
      id: "cannot-turn-draw",
      sourceUid: source!.uid,
      controller: 1,
      event: "continuous",
      code: 25,
      range: ["hand"],
      operation: () => undefined,
    });

    const end = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn");
    expect(end).toBeDefined();
    applyAndAssert(session, end!);

    expect(session.state.turnPlayer).toBe(1);
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "deck" });
    expect(session.state.cards.filter((card) => card.controller === 1 && card.location === "hand")).toHaveLength(1);
    expect(session.state.log.some((entry) => entry.action === "draw" && entry.card === "Blocked Turn Draw")).toBe(false);
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
