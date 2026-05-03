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
  it("rejects malformed snapshot root values before restore", () => {
    expect(() => restoreDuel(null, createCardReader(cards))).toThrow("Malformed duel snapshot: root must be an object");
  });

  it("rejects malformed snapshot roots before restore", () => {
    expect(() => restoreDuel({ version: 1, state: null }, createCardReader(cards))).toThrow("Malformed duel snapshot: state must be an object");
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

  it("rejects incomplete current-version snapshot collections before restore", () => {
    const session = createDuel({ seed: 139, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    (snapshot.state as { battlePairs?: unknown }).battlePairs = undefined;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battlePairs must be an array");
  });

  it("rejects malformed current-version snapshot scalar fields before restore", () => {
    const session = createDuel({ seed: 140, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    (snapshot.state as { turnPlayer?: unknown }).turnPlayer = 2;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.turnPlayer must be a player id");
  });

  it("rejects malformed current-version snapshot enum fields before restore", () => {
    const session = createDuel({ seed: 141, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badStatus = serializeDuel(session);
    const badPhase = serializeDuel(session);
    (badStatus.state as { status?: unknown }).status = "paused";
    (badPhase.state as { phase?: unknown }).phase = "combat";

    expect(() => restoreDuel(badStatus, createCardReader(cards))).toThrow("Malformed duel snapshot: state.status must be a duel status");
    expect(() => restoreDuel(badPhase, createCardReader(cards))).toThrow("Malformed duel snapshot: state.phase must be a duel phase");
  });

  it("rejects malformed optional prompt snapshots before restore", () => {
    const session = createDuel({ seed: 142, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badOptions = serializeDuel(session);
    const badReturnTo = serializeDuel(session);
    badOptions.state.prompt = { id: "bad-prompt", type: "selectOption", player: 0, options: "not-options" as unknown as number[] };
    badReturnTo.state.prompt = { id: "bad-return", type: "selectYesNo", player: 0, returnTo: 2 as 0 };

    expect(() => restoreDuel(badOptions, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.options must be an array");
    expect(() => restoreDuel(badReturnTo, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.returnTo must be a player id");
  });

  it("rejects malformed player and option snapshots before restore", () => {
    const session = createDuel({ seed: 145, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badPlayer = serializeDuel(session);
    const badOption = serializeDuel(session);
    badPlayer.state.players[1] = { ...badPlayer.state.players[1], lifePoints: "8000" as unknown as number };
    badOption.state.options = { ...badOption.state.options, drawPerTurn: "one" as unknown as number };

    expect(() => restoreDuel(badPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.players.1.lifePoints must be a number");
    expect(() => restoreDuel(badOption, createCardReader(cards))).toThrow("Malformed duel snapshot: state.options.drawPerTurn must be a number");
  });

  it("rejects malformed winner snapshots before restore", () => {
    const session = createDuel({ seed: 146, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badWinner = serializeDuel(session);
    const badWinReason = serializeDuel(session);
    badWinner.state.winner = "timeout" as unknown as 0;
    badWinReason.state.winReason = "battle" as unknown as number;

    expect(() => restoreDuel(badWinner, createCardReader(cards))).toThrow("Malformed duel snapshot: state.winner must be a player id");
    expect(() => restoreDuel(badWinReason, createCardReader(cards))).toThrow("Malformed duel snapshot: state.winReason must be a number");
  });

  it("rejects malformed snapshot player-id collections before restore", () => {
    const session = createDuel({ seed: 147, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badChainPasses = serializeDuel(session);
    badChainPasses.state.chainPasses = [0, 2 as 0];

    expect(() => restoreDuel(badChainPasses, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainPasses.1 must be a player id");
  });

  it("rejects malformed snapshot scalar collections before restore", () => {
    const session = createDuel({ seed: 148, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badDice = serializeDuel(session);
    const badUid = serializeDuel(session);
    badDice.state.lastDiceResults = [6, "one" as unknown as number];
    badUid.state.attackCanceledUids = ["attacker", 7 as unknown as string];

    expect(() => restoreDuel(badDice, createCardReader(cards))).toThrow("Malformed duel snapshot: state.lastDiceResults.1 must be a number");
    expect(() => restoreDuel(badUid, createCardReader(cards))).toThrow("Malformed duel snapshot: state.attackCanceledUids.1 must be a string");
  });

  it("rejects malformed snapshot battle pair collections before restore", () => {
    const session = createDuel({ seed: 149, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badPair = serializeDuel(session);
    badPair.state.battlePairs = [{ attackerUid: "attacker", targetUid: 7 as unknown as string }];

    expect(() => restoreDuel(badPair, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battlePairs.0.targetUid must be a string");
  });

  it("rejects malformed snapshot activity and damage records before restore", () => {
    const session = createDuel({ seed: 150, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badActivity = serializeDuel(session);
    const badBattleDamage = serializeDuel(session);
    badActivity.state.activityCounts[0] = { ...badActivity.state.activityCounts[0], attack: "one" as unknown as number };
    badBattleDamage.state.battleDamage = { ...badBattleDamage.state.battleDamage, 1: "1000" as unknown as number };

    expect(() => restoreDuel(badActivity, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityCounts.0.attack must be a number");
    expect(() => restoreDuel(badBattleDamage, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleDamage.1 must be a number");
  });

  it("rejects malformed pending trigger snapshots before restore", () => {
    const session = createDuel({ seed: 151, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badBucket = serializeDuel(session);
    const badPayload = serializeDuel(session);
    badBucket.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid: "source", effectId: "effect", eventName: "customEvent", triggerBucket: "optional" as "turnOptional" }];
    badPayload.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid: "source", effectId: "effect", eventName: "customEvent", triggerBucket: "turnOptional", eventPlayer: 2 as 0 }];

    expect(() => restoreDuel(badBucket, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.triggerBucket must be a trigger bucket");
    expect(() => restoreDuel(badPayload, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.eventPlayer must be a player id");
  });

  it("rejects malformed event history snapshots before restore", () => {
    const session = createDuel({ seed: 152, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badEventName = serializeDuel(session);
    const badPayload = serializeDuel(session);
    badEventName.state.eventHistory = [{ eventName: 12 as unknown as "customEvent" }];
    badPayload.state.eventHistory = [{ eventName: "customEvent", eventCardUid: 12 as unknown as string }];

    expect(() => restoreDuel(badEventName, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventName must be a string");
    expect(() => restoreDuel(badPayload, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventCardUid must be a string");
  });

  it("rejects malformed chain snapshots before restore", () => {
    const session = createDuel({ seed: 153, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badTargetUids = serializeDuel(session);
    const badPlayer = serializeDuel(session);
    badTargetUids.state.chain = [{ id: "link", player: 0, sourceUid: "source", effectId: "effect", targetUids: ["target", 7 as unknown as string] }];
    badPlayer.state.chain = [{ id: "link", player: 2 as 0, sourceUid: "source", effectId: "effect" }];

    expect(() => restoreDuel(badTargetUids, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.targetUids.1 must be a string");
    expect(() => restoreDuel(badPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.player must be a player id");
  });

  it("rejects malformed chain limit snapshots before restore", () => {
    const session = createDuel({ seed: 154, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badRegistryKey = serializeDuel(session);
    const badExpiry = serializeDuel(session);
    badRegistryKey.state.chainLimits = [{ registryKey: 7 as unknown as string, untilChainEnd: true }];
    badExpiry.state.chainLimits = [{ registryKey: "limit", expiresAtChainLength: "one" as unknown as number, untilChainEnd: true }];

    expect(() => restoreDuel(badRegistryKey, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainLimits.0.registryKey must be a string");
    expect(() => restoreDuel(badExpiry, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainLimits.0.expiresAtChainLength must be a number");
  });

  it("rejects malformed phase and activity history snapshots before restore", () => {
    const session = createDuel({ seed: 155, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badSkip = serializeDuel(session);
    const badActivity = serializeDuel(session);
    badSkip.state.skippedPhases = [{ player: 0, phase: "combat" as "battle", remaining: 1 }];
    badActivity.state.activityHistory = [{ player: 0, activity: "attack" as unknown as number }];

    expect(() => restoreDuel(badSkip, createCardReader(cards))).toThrow("Malformed duel snapshot: state.skippedPhases.0.phase must be a duel phase");
    expect(() => restoreDuel(badActivity, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityHistory.0.activity must be a number");
  });

  it("rejects malformed flag and log snapshots before restore", () => {
    const session = createDuel({ seed: 156, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badFlag = serializeDuel(session);
    const badLog = serializeDuel(session);
    badFlag.state.flagEffects = [{ ownerType: "duel" as "player", ownerId: "0", code: 1, reset: 0, property: 0, value: 1, turn: 1 }];
    badLog.state.log = [{ step: 1, action: "bad", player: 2 as 0, detail: "bad player" }];

    expect(() => restoreDuel(badFlag, createCardReader(cards))).toThrow("Malformed duel snapshot: state.flagEffects.0.ownerType must be a flag owner type");
    expect(() => restoreDuel(badLog, createCardReader(cards))).toThrow("Malformed duel snapshot: state.log.0.player must be a player id");
  });

  it("rejects malformed card snapshots before restore", () => {
    const session = createDuel({ seed: 157, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badOwner = serializeDuel(session);
    const badOverlay = serializeDuel(session);
    badOwner.state.cards[0] = { ...badOwner.state.cards[0]!, owner: 2 as 0 };
    badOverlay.state.cards[0] = { ...badOverlay.state.cards[0]!, overlayUids: ["mat", 7 as unknown as string] };

    expect(() => restoreDuel(badOwner, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.owner must be a player id");
    expect(() => restoreDuel(badOverlay, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.overlayUids.1 must be a string");
  });

  it("rejects malformed card data snapshots before restore", () => {
    const session = createDuel({ seed: 158, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badKind = serializeDuel(session);
    const badSynchro = serializeDuel(session);
    badKind.state.cards[0] = { ...badKind.state.cards[0]!, data: { ...badKind.state.cards[0]!.data, kind: "token" as "monster" } };
    badSynchro.state.cards[0] = { ...badSynchro.state.cards[0]!, data: { ...badSynchro.state.cards[0]!.data, synchroMaterials: { tuner: "100", nonTuners: [7 as unknown as string] } } };

    expect(() => restoreDuel(badKind, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.data.kind must be a card kind");
    expect(() => restoreDuel(badSynchro, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.data.synchroMaterials.nonTuners.0 must be a string");
  });

  it("rejects malformed effect snapshots before restore", () => {
    const session = createDuel({ seed: 159, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-shape-effect",
      registryKey: "snapshot-shape-effect",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation() {},
    });
    const badEvent = serializeDuel(session);
    const badRange = serializeDuel(session);
    badEvent.state.effects[0] = { ...badEvent.state.effects[0]!, event: "passive" as "ignition" };
    badRange.state.effects[0] = { ...badRange.state.effects[0]!, range: ["hand", "field" as "hand"] };

    expect(() => restoreDuel(badEvent, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.event must be an effect event");
    expect(() => restoreDuel(badRange, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.range.1 must be a card location");
  });

  it("rejects malformed effect reset and tuple snapshots before restore", () => {
    const session = createDuel({ seed: 160, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-shape-reset-effect",
      registryKey: "snapshot-shape-reset-effect",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      range: ["hand"],
      reset: { flags: 1 },
      targetRange: [1],
      operation() {},
    });
    const badReset = serializeDuel(session);
    const badTuple = serializeDuel(session);
    badReset.state.effects[0] = { ...badReset.state.effects[0]!, reset: { flags: "reset" as unknown as number } };
    badTuple.state.effects[0] = { ...badTuple.state.effects[0]!, targetRange: [1, 2, 3] as unknown as [number, number] };

    expect(() => restoreDuel(badReset, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.reset.flags must be a number");
    expect(() => restoreDuel(badTuple, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.targetRange must contain one or two numbers");
  });

  it("rejects malformed optional battle window snapshots before restore", () => {
    const session = createDuel({ seed: 143, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badKind = serializeDuel(session);
    const badResponsePlayer = serializeDuel(session);
    badKind.state.battleWindow = { id: 1, kind: "combat" as "attackDeclaration", step: "attack", attackerUid: "attacker", responsePlayer: 0, attackNegated: false };
    badResponsePlayer.state.battleWindow = { id: 1, kind: "attackDeclaration", step: "attack", attackerUid: "attacker", responsePlayer: 2 as 0, attackNegated: false };

    expect(() => restoreDuel(badKind, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.kind must be a battle window kind");
    expect(() => restoreDuel(badResponsePlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.responsePlayer must be a player id");
  });

  it("rejects malformed optional pending battle snapshots before restore", () => {
    const session = createDuel({ seed: 144, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badCurrentAttack = serializeDuel(session);
    const badPendingBattle = serializeDuel(session);
    badCurrentAttack.state.currentAttack = { attackerUid: "attacker", replayTargetCount: "two" as unknown as number };
    badPendingBattle.state.pendingBattle = { attackerUid: "attacker", battleDamageOverrides: { 2: 100 } as unknown as Record<0 | 1, number> };

    expect(() => restoreDuel(badCurrentAttack, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.replayTargetCount must be a number");
    expect(() => restoreDuel(badPendingBattle, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.battleDamageOverrides must use player ids");
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
