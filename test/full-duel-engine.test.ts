import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  restoreDuel,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("full duel engine API", () => {
  it("starts a deterministic two-player duel and exposes legal responses", () => {
    const session = createDuel({ seed: 7, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const state = queryPublicState(session);
    expect(state.status).toBe("awaiting");
    expect(state.turn).toBe(1);
    expect(state.phase).toBe("main1");
    expect(state.cards.filter((card) => card.controller === 0 && card.location === "hand")).toHaveLength(2);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "normalSummon")).toBe(true);
    expect(getDuelLegalActions(session, 1)).toEqual([]);
  });

  it("exposes pending prompts as legal responses and preserves them in snapshots", () => {
    const session = createDuel({ seed: 71, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    session.state.prompt = { id: "prompt-1", type: "selectOption", player: 1, options: [0, 2], descriptions: [101, 202], returnTo: 0 };
    session.state.waitingFor = 1;

    expect(queryPublicState(session).prompt).toEqual({ id: "prompt-1", type: "selectOption", player: 1, options: [0, 2], descriptions: [101, 202], returnTo: 0 });
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(queryPublicState(restored).prompt).toEqual({ id: "prompt-1", type: "selectOption", player: 1, options: [0, 2], descriptions: [101, 202], returnTo: 0 });
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual([]);

    const options = getDuelLegalActions(restored, 1);
    expect(options).toEqual([
      { type: "selectOption", player: 1, promptId: "prompt-1", option: 0, label: "Select option 0 (101)", windowId: 0, windowKind: "prompt", windowToken: restored.state.actionWindowToken },
      { type: "selectOption", player: 1, promptId: "prompt-1", option: 2, label: "Select option 2 (202)", windowId: 0, windowKind: "prompt", windowToken: restored.state.actionWindowToken },
    ]);
    expect(getGroupedDuelLegalActions(restored, 1).flatMap((group) => group.actions)).toEqual(options);
    const optionResult = applyResponse(restored, options[1]!);
    expect(optionResult.ok).toBe(true);
    expect(optionResult.state.prompt).toBeUndefined();
    expect(optionResult.state.waitingFor).toBe(0);
    expect(optionResult.state.log.some((entry) => entry.action === "selectOption" && entry.detail === "Selected option 2")).toBe(true);

    restored.state.prompt = { id: "prompt-2", type: "selectYesNo", player: 0, description: 123 };
    restored.state.waitingFor = 0;
    const no = getDuelLegalActions(restored, 0).find((action) => action.type === "selectYesNo" && !action.yes);
    expect(no).toEqual({ type: "selectYesNo", player: 0, promptId: "prompt-2", yes: false, label: "No", windowId: 1, windowKind: "prompt", windowToken: restored.state.actionWindowToken });
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toContainEqual(no);
    const yesNoResult = applyResponse(restored, no!);
    expect(yesNoResult.ok).toBe(true);
    expect(yesNoResult.state.log.some((entry) => entry.action === "selectYesNo" && entry.detail === "Selected no")).toBe(true);
  });

  it("applies legal responses and preserves zone invariants through serialization", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon");
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "normalSummon")).toHaveLength(0);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const publicState = queryPublicState(restored);
    expect(publicState.cards.filter((card) => card.location === "monsterZone" && card.controller === 0)).toHaveLength(1);
    expect(publicState.cards.map((card) => card.uid)).toHaveLength(new Set(publicState.cards.map((card) => card.uid)).size);
  });
});
