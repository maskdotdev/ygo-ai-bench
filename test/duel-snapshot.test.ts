import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import {
  applyResponse,
  createDuel,
  fusionSummonDuelCard,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  restoreDuel,
  serializeDuel,
  sendDuelCardToGraveyard,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("duel snapshot persistence", () => {
  it("rejects malformed snapshot roots before restore", () => {
    expect(() => restoreDuel({ version: 1, state: null } as never, createCardReader(cards))).toThrow("Malformed duel snapshot: state must be an object");
  });

  it("rejects malformed snapshot collections before restore", () => {
    const session = createDuel({ seed: 138, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    (snapshot.state as { cards?: unknown }).cards = undefined;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards must be an array");
  });

  it("serializes every initialized duel state key", () => {
    const session = createDuel({ seed: 137, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    const missingSnapshotKeys = Object.keys(session.state).filter((key) => !(key in snapshot.state));
    const restored = restoreDuel(snapshot, createCardReader(cards));
    const missingRestoredKeys = Object.keys(session.state).filter((key) => !(key in restored.state));

    expect(missingSnapshotKeys).toEqual([]);
    expect(missingRestoredKeys).toEqual([]);
  });

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

  it("keeps internal chain operation overrides out of public and serialized state", () => {
    const session = createDuel({ seed: 128, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    session.state.chain = [
      {
        id: "chain-1",
        player: 0,
        sourceUid: "source",
        effectId: "effect",
        targetUids: ["target-a"],
        operationOverride(ctx) {
          ctx.log("internal override");
        },
      },
    ];

    const publicLink = queryPublicState(session).chain[0] as { operationOverride?: unknown; targetUids?: string[] };
    const serializedLink = serializeDuel(session).state.chain[0] as { operationOverride?: unknown; targetUids?: string[] };

    expect(publicLink.operationOverride).toBeUndefined();
    expect(serializedLink.operationOverride).toBeUndefined();
    publicLink.targetUids!.push("target-b");
    serializedLink.targetUids!.push("target-c");
    expect(session.state.chain[0]?.targetUids).toEqual(["target-a"]);
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

  it("keeps unregistered continuous effect callbacks out of snapshots", () => {
    const session = createDuel({ seed: 129, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-unregistered-predicate",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 235,
      range: ["hand"],
      targetCardPredicate: (_ctx, card) => card.uid === source!.uid,
      operation() {},
    });

    const snapshot = serializeDuel(session);
    const restored = restoreDuel(snapshot, createCardReader(cards));

    expect(snapshot.state.effects).toEqual([]);
    expect(restored.state.effects).toEqual([]);
  });

  it("strips registry-backed effect callbacks from snapshot data", () => {
    const session = createDuel({ seed: 130, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-registry-predicate",
      registryKey: "snapshot-registry-predicate",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 235,
      range: ["hand"],
      targetCardPredicate: (_ctx, card) => card.uid === source!.uid,
      operation() {},
    });

    const serialized = serializeDuel(session).state.effects[0] as {
      operation?: unknown;
      targetCardPredicate?: unknown;
    };

    expect(serialized).toMatchObject({ id: "snapshot-registry-predicate", registryKey: "snapshot-registry-predicate" });
    expect(serialized.operation).toBeUndefined();
    expect(serialized.targetCardPredicate).toBeUndefined();
  });

  it("produces data-only JSON snapshots when live state contains callbacks", () => {
    const session = createDuel({ seed: 131, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-json-effect",
      registryKey: "snapshot-json-effect",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        ctx.log("callback should not serialize");
      },
    });
    session.state.chainLimits.push({
      registryKey: "snapshot-json-chain-limit",
      untilChainEnd: true,
      allows: () => false,
      release() {},
    });

    const roundTripped = JSON.parse(JSON.stringify(serializeDuel(session))) as ReturnType<typeof serializeDuel>;

    expect(roundTripped.state.effects[0]).toMatchObject({ id: "snapshot-json-effect", registryKey: "snapshot-json-effect" });
    expect(roundTripped.state.chainLimits[0]).toEqual({ registryKey: "snapshot-json-chain-limit", untilChainEnd: true });
  });

  it("copies nested assumed card state by value across snapshots", () => {
    const session = createDuel({ seed: 126, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const card = session.state.cards.find((candidate) => candidate.code === "100");
    expect(card).toBeTruthy();
    card!.assumedProperties = { 1: 999, 10: 15 };
    card!.uniqueOnField = { self: true, opponent: false, code: 100, locationMask: 0x04 };

    const snapshot = serializeDuel(session);
    card!.assumedProperties[1] = 888;
    card!.uniqueOnField.code = 200;

    const restored = restoreDuel(snapshot, createCardReader(cards));
    const restoredCard = restored.state.cards.find((candidate) => candidate.uid === card!.uid);

    expect(restoredCard?.assumedProperties).toEqual({ 1: 999, 10: 15 });
    expect(restoredCard?.uniqueOnField).toEqual({ self: true, opponent: false, code: 100, locationMask: 0x04 });

    snapshot.state.cards.find((candidate) => candidate.uid === card!.uid)!.assumedProperties![1] = 777;
    snapshot.state.cards.find((candidate) => candidate.uid === card!.uid)!.uniqueOnField!.code = 300;

    expect(restoredCard?.assumedProperties).toEqual({ 1: 999, 10: 15 });
    expect(restoredCard?.uniqueOnField).toEqual({ self: true, opponent: false, code: 100, locationMask: 0x04 });
  });

  it("copies nested card data by value across snapshots", () => {
    const session = createDuel({ seed: 127, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const card = session.state.cards.find((candidate) => candidate.code === "100");
    expect(card).toBeTruthy();
    card!.data = {
      ...card!.data,
      setcodes: [0x10],
      fusionMaterials: ["100", "300"],
      synchroMaterials: { tuner: "100", nonTuners: ["300"] },
      listedNames: ["400"],
    };

    const snapshot = serializeDuel(session);
    card!.data.setcodes!.push(0x20);
    card!.data.fusionMaterials!.push("400");
    card!.data.synchroMaterials!.nonTuners.push("500");
    card!.data.listedNames!.push("500");

    const restored = restoreDuel(snapshot, createCardReader(cards));
    const restoredCard = restored.state.cards.find((candidate) => candidate.uid === card!.uid);

    expect(restoredCard?.data.setcodes).toEqual([0x10]);
    expect(restoredCard?.data.fusionMaterials).toEqual(["100", "300"]);
    expect(restoredCard?.data.synchroMaterials).toEqual({ tuner: "100", nonTuners: ["300"] });
    expect(restoredCard?.data.listedNames).toEqual(["400"]);
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
