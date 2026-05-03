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

  it("restores registry-backed chain limits across snapshots", () => {
    const session = createDuel({ seed: 125, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    session.state.chainLimits.push({
      registryKey: "snapshot-chain-limit",
      untilChainEnd: true,
      allows: () => false,
    });

    const withoutRegistry = restoreDuel(serializeDuel(session), createCardReader(cards));
    expect(withoutRegistry.state.chainLimits).toEqual([]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {}, {
      "snapshot-chain-limit": (limit) => ({
        ...limit,
        allows: (effect) => effect.id === "allowed-after-restore",
      }),
    });

    expect(restored.state.chainLimits).toHaveLength(1);
    const restoredLimit = restored.state.chainLimits[0]!;
    expect(restoredLimit).toMatchObject({ registryKey: "snapshot-chain-limit", untilChainEnd: true });
    expect(restoredLimit.allows({ id: "blocked-after-restore", sourceUid: "missing", controller: 0, event: "quick", range: ["hand"], operation() {} }, 0, 0)).toBe(false);
    expect(restoredLimit.allows({ id: "allowed-after-restore", sourceUid: "missing", controller: 0, event: "quick", range: ["hand"], operation() {} }, 0, 0)).toBe(true);
  });

  it("preserves pending trigger timing metadata across snapshots", () => {
    const session = createDuel({ seed: 123, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const triggerSource = findPublicCard(session, 0, "hand", "100");
    const moved = findPublicCard(session, 0, "hand", "300");
    expect(triggerSource).toBeTruthy();
    expect(moved).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-delayed-trigger",
      registryKey: "delayed-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "sentToGraveyard",
      triggerTiming: "if",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Restored delayed trigger resolved");
      },
    });

    sendDuelCardToGraveyard(session.state, moved!.uid, 0);
    expect(session.state.pendingTriggers).toHaveLength(1);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "delayed-trigger": (effect) => ({
        ...effect,
        operation(ctx) {
          ctx.log("Restored delayed trigger resolved");
        },
      }),
    });

    expect(restored.state.effects[0]).toMatchObject({ triggerTiming: "if", triggerEvent: "sentToGraveyard" });
    expect(restored.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    const action = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "snapshot-delayed-trigger");
    expect(action).toBeTruthy();
    const result = applyResponse(restored, action!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Restored delayed trigger resolved")).toBe(true);
  });

  it("prunes pending triggers whose non-registry effects cannot be restored", () => {
    const session = createDuel({ seed: 124, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const summoned = findPublicCard(session, 0, "hand", "100");
    const triggerSource = findPublicCard(session, 0, "hand", "300");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    registerEffect(session, {
      id: "non-registry-pending-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Non-registry trigger should not restore");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["non-registry-pending-trigger"]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));

    expect(restored.state.effects).toEqual([]);
    expect(restored.state.pendingTriggers).toEqual([]);
    expect(restored.state.waitingFor).toBe(0);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "activateTrigger")).toBe(false);
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
