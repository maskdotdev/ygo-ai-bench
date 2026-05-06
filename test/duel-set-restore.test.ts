import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

function expectCurrentWindowMetadata(session: ReturnType<typeof restoreDuel>, response: ReturnType<typeof applyResponse>): void {
  for (const action of response.legalActions) expect(action).toMatchObject({ windowId: session.state.actionWindowId, windowKind: response.state.windowKind });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId: session.state.actionWindowId, windowKind: response.state.windowKind });
}

describe("set action restore", () => {
  it("restores monster set legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === monster!.uid);
    expect(action).toBeDefined();
    expect(action).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "open" });

    const staleResult = applyResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleResult.legalActions);
    expectCurrentWindowMetadata(restored, staleResult);
    expect(restored.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "hand" });
    expect(restored.state.log.some((entry) => entry.action === "setMonster" && entry.card === "Normal Test Monster")).toBe(false);

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ location: "monsterZone", position: "faceDownDefense", faceUp: false });
    expect(result.state.players[0].normalSummonAvailable).toBe(false);
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.state.log.some((entry) => entry.action === "setMonster" && entry.card === "Normal Test Monster")).toBe(true);
    const staleReplay = applyResponse(restored, action!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    expect(staleReplay.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(staleReplay.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleReplay.legalActions);
    expectCurrentWindowMetadata(restored, staleReplay);
  });

  it("restores spell/trap set legal actions and applies the restored action", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["200"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const spell = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(spell).toBeTruthy();
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "setSpellTrap" && candidate.uid === spell!.uid);
    expect(action).toBeDefined();
    expect(action).toMatchObject({ windowId: queryPublicState(restored).actionWindowId, windowKind: "open" });

    const staleResult = applyResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleResult.legalActions);
    expectCurrentWindowMetadata(restored, staleResult);
    expect(restored.state.cards.find((card) => card.uid === spell!.uid)).toMatchObject({ location: "hand" });
    expect(restored.state.log.some((entry) => entry.action === "set" && entry.card === "Test Spell")).toBe(false);

    const result = applyResponse(restored, action!);
    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === spell!.uid)).toMatchObject({ location: "spellTrapZone", position: "faceDown", faceUp: false });
    expect(result.state.waitingFor).toBeDefined();
    expect(result.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(result.state.log.some((entry) => entry.action === "set" && entry.card === "Test Spell")).toBe(true);
    const staleReplay = applyResponse(restored, action!);
    expect(staleReplay.ok).toBe(false);
    expect(staleReplay.error).toContain("Response is not currently legal");
    expect(staleReplay.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleReplay.legalActions).toEqual(getDuelLegalActions(restored, result.state.waitingFor!));
    expect(staleReplay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, result.state.waitingFor!));
    expect(staleReplay.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleReplay.legalActions);
    expectCurrentWindowMetadata(restored, staleReplay);
  });
});
