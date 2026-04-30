import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
  createDuel,
  fusionSummonDuelCard,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  registerEffect,
  restoreDuel,
  serializeDuel,
  sendDuelCardToGraveyard,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("duel snapshot persistence", () => {
  it("preserves skipped phases across snapshots", () => {
    const session = createDuel({ seed: 122, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    session.state.skippedPhases.push({ player: 0, phase: "battle", remaining: 1 });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    const next = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "changePhase");

    expect(restored.state.skippedPhases).toEqual([{ player: 0, phase: "battle", remaining: 1 }]);
    expect(next).toMatchObject({ phase: "main2" });
    expect(applyResponse(restored, next!).ok).toBe(true);
    expect(restored.state.skippedPhases).toEqual([]);
  });

  it("preserves static continuous effects across snapshots", () => {
    const session = createDuel({ seed: 95, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"], extra: ["900"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const fusion = findPublicCard(session, 0, "extraDeck", "900");
    const blockedMaterial = findPublicCard(session, 0, "hand", "100");
    expect(fusion).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    registerEffect(session, {
      id: "snapshot-cannot-be-fusion-material",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 235,
      range: ["hand"],
      operation() {},
    });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));

    expect(restored.state.effects).toHaveLength(1);
    expect(restored.state.effects[0]).toMatchObject({ id: "snapshot-cannot-be-fusion-material", event: "continuous", code: 235 });
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "fusionSummon" && candidate.uid === fusion!.uid)).toBe(false);
    expect(() =>
      fusionSummonDuelCard(
        restored.state,
        0,
        fusion!.uid,
        restored.state.cards
          .filter((card) => card.controller === 0 && card.location === "hand" && (card.code === "100" || card.code === "300"))
          .map((card) => card.uid),
      ),
    ).toThrow("cannot be used as fusion material");
  });

  it("restores registry-backed effects across snapshots", () => {
    const session = createDuel({ seed: 96, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-send-self",
      registryKey: "send-self",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, ctx.source.uid, ctx.player);
      },
    });

    const withoutRegistry = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(withoutRegistry.state.effects).toHaveLength(0);
    expect(getDuelLegalActions(withoutRegistry, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "snapshot-send-self")).toBe(false);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "send-self": (effect) => ({
        ...effect,
        operation(ctx) {
          sendDuelCardToGraveyard(ctx.duel, ctx.source.uid, ctx.player);
        },
      }),
    });
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "snapshot-send-self");
    expect(action).toBeTruthy();
    const result = applyResponse(restored, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === source!.uid)?.location).toBe("graveyard");
  });

  it("keeps reset-pruned effects gone across snapshots", () => {
    const session = createDuel({ seed: 121, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-reset-pruned",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      reset: { flags: 0x1000 + 0x40000 },
      operation(ctx) {
        sendDuelCardToGraveyard(ctx.duel, ctx.source.uid, ctx.player);
      },
    });
    expect(session.state.effects).toHaveLength(1);

    moveDuelCard(session.state, source!.uid, "graveyard", 0);

    expect(session.state.effects).toHaveLength(0);
    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(restored.state.effects).toHaveLength(0);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "snapshot-reset-pruned")).toBe(false);
  });
});
