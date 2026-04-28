import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createCardReader,
  createDuel,
  getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  restoreDuel,
  serializeDuel,
  startDuel,
} from "../src/engine/index.js";
import type { DuelCardData } from "../src/engine/index.js";

const cards: DuelCardData[] = [
  { code: "100", name: "Normal Test Monster", kind: "monster" },
  { code: "200", name: "Test Spell", kind: "spell" },
  { code: "300", name: "Second Monster", kind: "monster" },
  { code: "400", name: "Opponent Monster", kind: "monster" },
];

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

  it("resolves registered once-per-turn effects through the chain", () => {
    const session = createDuel({ seed: 2, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "send-self",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      oncePerTurn: true,
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("Sent itself to the Graveyard");
      },
    });

    const effect = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "send-self");
    expect(effect).toBeTruthy();
    const result = applyResponse(session, effect!);

    expect(result.ok).toBe(true);
    expect(result.state.chain).toHaveLength(0);
    expect(result.state.cards.find((card) => card.uid === source!.uid)?.location).toBe("graveyard");
    expect(result.state.log.some((entry) => entry.detail.includes("Sent itself"))).toBe(true);
  });

  it("exposes trigger effects as pending legal responses after a normal summon", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();

    registerEffect(session, {
      id: "on-normal-summon",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log(`Saw ${ctx.eventCard?.name ?? "a card"} Normal Summoned`);
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    const summonResult = applyResponse(session, summon!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.pendingTriggers).toHaveLength(1);
    expect(summonResult.state.cards.find((card) => card.uid === triggerSource!.uid)?.location).toBe("hand");
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    const triggerResult = applyResponse(session, trigger!);

    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.state.pendingTriggers).toHaveLength(0);
    expect(triggerResult.state.cards.find((card) => card.uid === triggerSource!.uid)?.location).toBe("graveyard");
    expect(triggerResult.state.log.some((entry) => entry.action === "trigger" && entry.detail === "on-normal-summon")).toBe(true);
    expect(triggerResult.state.log.some((entry) => entry.detail.includes("Normal Summoned"))).toBe(true);
  });
});
