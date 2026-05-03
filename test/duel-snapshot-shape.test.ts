import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("duel snapshot restore shape validation", () => {
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
    const badOptionValue = serializeDuel(session);
    const badPromptType = serializeDuel(session);
    const badDescription = serializeDuel(session);
    const badReturnTo = serializeDuel(session);
    badOptions.state.prompt = { id: "bad-prompt", type: "selectOption", player: 0, options: "not-options" as unknown as number[] };
    badOptionValue.state.prompt = { id: "bad-option-value", type: "selectOption", player: 0, options: [1, "two" as unknown as number] };
    badPromptType.state.prompt = { id: "bad-type", type: "selectCard" as "selectOption", player: 0, options: [1] };
    badDescription.state.prompt = { id: "bad-description", type: "selectYesNo", player: 0, description: "yes" as unknown as number };
    badReturnTo.state.prompt = { id: "bad-return", type: "selectYesNo", player: 0, returnTo: 2 as 0 };

    expect(() => restoreDuel(badOptions, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.options must be an array");
    expect(() => restoreDuel(badOptionValue, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.options must contain numbers");
    expect(() => restoreDuel(badPromptType, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.type must be a prompt type");
    expect(() => restoreDuel(badDescription, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt.description must be a number");
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

  it("rejects missing card references in snapshot uid collections before restore", () => {
    const session = createDuel({ seed: 170, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badAttack = serializeDuel(session);
    const badPosition = serializeDuel(session);
    badAttack.state.attacksDeclared = ["missing"];
    badPosition.state.positionsChanged = [badPosition.state.cards[0]!.uid, "missing"];

    expect(() => restoreDuel(badAttack, createCardReader(cards))).toThrow("Malformed duel snapshot: state.attacksDeclared.0 must reference a card");
    expect(() => restoreDuel(badPosition, createCardReader(cards))).toThrow("Malformed duel snapshot: state.positionsChanged.1 must reference a card");
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

  it("rejects missing battle card references before restore", () => {
    const session = createDuel({ seed: 165, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badPair = serializeDuel(session);
    const badWindow = serializeDuel(session);
    badPair.state.battlePairs = [{ attackerUid: "missing", targetUid: badPair.state.cards[0]!.uid }];
    badWindow.state.battleWindow = { id: 1, kind: "attackDeclaration", step: "attack", attackerUid: "missing", responsePlayer: 0, attackNegated: false };

    expect(() => restoreDuel(badPair, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battlePairs.0.attackerUid must reference a card");
    expect(() => restoreDuel(badWindow, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.attackerUid must reference a card");
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
    const badBucketPlayer = serializeDuel(session);
    badBucket.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid: "source", effectId: "effect", eventName: "customEvent", triggerBucket: "optional" as "turnOptional" }];
    badPayload.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid: "source", effectId: "effect", eventName: "customEvent", triggerBucket: "turnOptional", eventPlayer: 2 as 0 }];
    badBucketPlayer.state.pendingTriggers = [{ id: "trigger", player: 1, sourceUid: "source", effectId: "effect", eventName: "customEvent", triggerBucket: "turnOptional" }];

    expect(() => restoreDuel(badBucket, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.triggerBucket must be a trigger bucket");
    expect(() => restoreDuel(badPayload, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.eventPlayer must be a player id");
    expect(() => restoreDuel(badBucketPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.triggerBucket must match the trigger player");
  });

  it("rejects missing pending trigger card references before restore", () => {
    const session = createDuel({ seed: 167, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const badSource = serializeDuel(session);
    const badEventCard = serializeDuel(session);
    const badEventUid = serializeDuel(session);
    badSource.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid: "missing", effectId: "effect", eventName: "customEvent", triggerBucket: "turnOptional" }];
    badEventCard.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid, effectId: "effect", eventName: "customEvent", triggerBucket: "turnOptional", eventCardUid: "missing" }];
    badEventUid.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid, effectId: "effect", eventName: "customEvent", triggerBucket: "turnOptional", eventUids: ["missing"] }];

    expect(() => restoreDuel(badSource, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.sourceUid must reference a card");
    expect(() => restoreDuel(badEventCard, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.eventCardUid must reference a card");
    expect(() => restoreDuel(badEventUid, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggers.0.eventUids.0 must reference a card");
  });

  it("rejects malformed pending trigger bucket snapshots before restore", () => {
    const session = createDuel({ seed: 168, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const badBucket = serializeDuel(session);
    const badPlayer = serializeDuel(session);
    const badTriggerIds = serializeDuel(session);
    const badTriggerRef = serializeDuel(session);
    const badBucketOrder = serializeDuel(session);
    const badBucketIds = serializeDuel(session);
    for (const snapshot of [badBucket, badPlayer, badTriggerIds, badTriggerRef, badBucketOrder, badBucketIds]) {
      snapshot.state.pendingTriggers = [{ id: "trigger", player: 0, sourceUid, effectId: "effect", eventName: "customEvent", triggerBucket: "turnOptional" }];
    }
    badBucket.state.pendingTriggerBuckets = [{ triggerBucket: "optional" as "turnOptional", player: 0, triggerIds: ["trigger"] }];
    badPlayer.state.pendingTriggerBuckets = [{ triggerBucket: "turnOptional", player: 2 as 0, triggerIds: ["trigger"] }];
    badTriggerIds.state.pendingTriggerBuckets = [{ triggerBucket: "turnOptional", player: 0, triggerIds: "trigger" as unknown as string[] }];
    badTriggerRef.state.pendingTriggerBuckets = [{ triggerBucket: "turnOptional", player: 0, triggerIds: ["missing"] }];
    badBucketOrder.state.pendingTriggerBuckets = [{ triggerBucket: "opponentOptional", player: 0, triggerIds: ["trigger"] }];
    badBucketIds.state.pendingTriggers.push({ id: "second-trigger", player: 0, sourceUid, effectId: "second-effect", eventName: "customEvent", triggerBucket: "turnOptional" });
    badBucketIds.state.pendingTriggerBuckets = [{ triggerBucket: "turnOptional", player: 0, triggerIds: ["second-trigger", "trigger"] }];

    expect(() => restoreDuel(badBucket, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets.0.triggerBucket must be a trigger bucket");
    expect(() => restoreDuel(badPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets.0.player must be a player id");
    expect(() => restoreDuel(badTriggerIds, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets.0.triggerIds must be an array");
    expect(() => restoreDuel(badTriggerRef, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets.0.triggerIds.0 must reference a pending trigger");
    expect(() => restoreDuel(badBucketOrder, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets must match pendingTriggers");
    expect(() => restoreDuel(badBucketIds, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingTriggerBuckets must match pendingTriggers");
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
    const badEventUids = serializeDuel(session);
    badEventName.state.eventHistory = [{ eventName: 12 as unknown as "customEvent" }];
    badPayload.state.eventHistory = [{ eventName: "customEvent", eventCardUid: 12 as unknown as string }];
    badEventUids.state.eventHistory = [{ eventName: "customEvent", eventUids: "uid" as unknown as string[] }];

    expect(() => restoreDuel(badEventName, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventName must be a string");
    expect(() => restoreDuel(badPayload, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventCardUid must be a string");
    expect(() => restoreDuel(badEventUids, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventUids must be an array");
  });

  it("rejects missing event history card references before restore", () => {
    const session = createDuel({ seed: 168, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    const badEventUid = serializeDuel(session);
    snapshot.state.eventHistory = [{ eventName: "customEvent", eventCardUid: "missing" }];
    badEventUid.state.eventHistory = [{ eventName: "customEvent", eventUids: ["missing"] }];

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventCardUid must reference a card");
    expect(() => restoreDuel(badEventUid, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventUids.0 must reference a card");
  });

  it("rejects malformed chain snapshots before restore", () => {
    const session = createDuel({ seed: 153, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const badTargetUids = serializeDuel(session);
    const badEventUids = serializeDuel(session);
    const badPlayer = serializeDuel(session);
    const badActivationLocation = serializeDuel(session);
    badTargetUids.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", targetUids: ["target", 7 as unknown as string] }];
    badEventUids.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", eventUids: [7 as unknown as string] }];
    badPlayer.state.chain = [{ id: "link", player: 2 as 0, sourceUid, effectId: "effect" }];
    badActivationLocation.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", activationLocation: "field" as "hand" }];

    expect(() => restoreDuel(badTargetUids, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.targetUids.1 must be a string");
    expect(() => restoreDuel(badEventUids, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.eventUids.0 must reference a card");
    expect(() => restoreDuel(badPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.player must be a player id");
    expect(() => restoreDuel(badActivationLocation, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.activationLocation must be a card location");
  });

  it("rejects missing chain target and event card snapshots before restore", () => {
    const session = createDuel({ seed: 169, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = serializeDuel(session).state.cards[0]!.uid;
    const badTarget = serializeDuel(session);
    const badEventCard = serializeDuel(session);
    const badEventUid = serializeDuel(session);
    badTarget.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", targetUids: ["missing"] }];
    badEventCard.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", eventCardUid: "missing" }];
    badEventUid.state.chain = [{ id: "link", player: 0, sourceUid, effectId: "effect", eventUids: ["missing"] }];

    expect(() => restoreDuel(badTarget, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.targetUids.0 must reference a card");
    expect(() => restoreDuel(badEventCard, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.eventCardUid must reference a card");
    expect(() => restoreDuel(badEventUid, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.eventUids.0 must reference a card");
  });

  it("rejects missing chain and effect source card snapshots before restore", () => {
    const session = createDuel({ seed: 164, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const source = findPublicCard(session, 0, "hand", "100");
    expect(source).toBeTruthy();
    registerEffect(session, {
      id: "snapshot-missing-source-effect",
      registryKey: "snapshot-missing-source-effect",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation() {},
    });
    const missingChainSource = serializeDuel(session);
    const missingEffectSource = serializeDuel(session);
    missingChainSource.state.chain = [{ id: "link", player: 0, sourceUid: "missing", effectId: "effect" }];
    missingEffectSource.state.effects[0] = { ...missingEffectSource.state.effects[0]!, sourceUid: "missing" };

    expect(() => restoreDuel(missingChainSource, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chain.0.sourceUid must reference a card");
    expect(() => restoreDuel(missingEffectSource, createCardReader(cards))).toThrow("Malformed duel snapshot: state.effects.0.sourceUid must reference a card");
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

  it("rejects missing activity history card references before restore", () => {
    const session = createDuel({ seed: 171, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    snapshot.state.activityHistory = [{ player: 0, activity: 1, cardUid: "missing" }];

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityHistory.0.cardUid must reference a card");
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

  it("rejects malformed flag owner snapshots before restore", () => {
    const session = createDuel({ seed: 172, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badPlayer = serializeDuel(session);
    const badCard = serializeDuel(session);
    badPlayer.state.flagEffects = [{ ownerType: "player", ownerId: "2", code: 1, reset: 0, property: 0, value: 1, turn: 1 }];
    badCard.state.flagEffects = [{ ownerType: "card", ownerId: "missing", code: 1, reset: 0, property: 0, value: 1, turn: 1 }];

    expect(() => restoreDuel(badPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.flagEffects.0.ownerId must be a player id");
    expect(() => restoreDuel(badCard, createCardReader(cards))).toThrow("Malformed duel snapshot: state.flagEffects.0.ownerId must reference a card");
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

  it("rejects malformed unique card state snapshots before restore", () => {
    const session = createDuel({ seed: 161, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badUnique = serializeDuel(session);
    badUnique.state.cards[0] = { ...badUnique.state.cards[0]!, uniqueOnField: { self: true, opponent: "no" as unknown as boolean, code: 100, locationMask: 0x04 } };

    expect(() => restoreDuel(badUnique, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.uniqueOnField.opponent must be a boolean");
  });

  it("rejects duplicate card uid snapshots before restore", () => {
    const session = createDuel({ seed: 162, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const duplicateUid = serializeDuel(session);
    duplicateUid.state.cards[1] = { ...duplicateUid.state.cards[1]!, uid: duplicateUid.state.cards[0]!.uid };

    expect(() => restoreDuel(duplicateUid, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.1.uid must be unique");
  });

  it("rejects broken overlay references before restore", () => {
    const session = createDuel({ seed: 163, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const missingOverlay = serializeDuel(session);
    const wrongLocation = serializeDuel(session);
    missingOverlay.state.cards[0] = { ...missingOverlay.state.cards[0]!, overlayUids: ["missing-material"] };
    wrongLocation.state.cards[0] = { ...wrongLocation.state.cards[0]!, overlayUids: [wrongLocation.state.cards[1]!.uid] };

    expect(() => restoreDuel(missingOverlay, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.overlayUids.0 must reference a card");
    expect(() => restoreDuel(wrongLocation, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.overlayUids.0 must reference an overlay card");
  });

  it("rejects broken card state references before restore", () => {
    const session = createDuel({ seed: 166, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badEquippedTo = serializeDuel(session);
    const badMaterial = serializeDuel(session);
    badEquippedTo.state.cards[0] = { ...badEquippedTo.state.cards[0]!, equippedToUid: "missing" };
    badMaterial.state.cards[0] = { ...badMaterial.state.cards[0]!, summonMaterialUids: [badMaterial.state.cards[1]!.uid, "missing"] };

    expect(() => restoreDuel(badEquippedTo, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.equippedToUid must reference a card");
    expect(() => restoreDuel(badMaterial, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.summonMaterialUids.1 must reference a card");
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
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const targetUid = serializeDuel(session).state.cards[1]!.uid;
    const badId = serializeDuel(session);
    const badKind = serializeDuel(session);
    const badStep = serializeDuel(session);
    const badTarget = serializeDuel(session);
    const badAttackNegated = serializeDuel(session);
    const badResponsePlayer = serializeDuel(session);
    badId.state.battleWindow = { id: "one" as unknown as number, kind: "attackDeclaration", step: "attack", attackerUid, targetUid, responsePlayer: 0, attackNegated: false };
    badKind.state.battleWindow = { id: 1, kind: "combat" as "attackDeclaration", step: "attack", attackerUid, responsePlayer: 0, attackNegated: false };
    badStep.state.battleWindow = { id: 1, kind: "attackDeclaration", step: "combat" as "attack", attackerUid, targetUid, responsePlayer: 0, attackNegated: false };
    badTarget.state.battleWindow = { id: 1, kind: "attackDeclaration", step: "attack", attackerUid, targetUid: "missing", responsePlayer: 0, attackNegated: false };
    badAttackNegated.state.battleWindow = { id: 1, kind: "attackDeclaration", step: "attack", attackerUid, targetUid, responsePlayer: 0, attackNegated: "no" as unknown as boolean };
    badResponsePlayer.state.battleWindow = { id: 1, kind: "attackDeclaration", step: "attack", attackerUid, responsePlayer: 2 as 0, attackNegated: false };

    expect(() => restoreDuel(badId, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.id must be a number");
    expect(() => restoreDuel(badKind, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.kind must be a battle window kind");
    expect(() => restoreDuel(badStep, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.step must be a battle step");
    expect(() => restoreDuel(badTarget, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.targetUid must reference a card");
    expect(() => restoreDuel(badAttackNegated, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.attackNegated must be a boolean");
    expect(() => restoreDuel(badResponsePlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.responsePlayer must be a player id");
  });

  it("rejects malformed optional pending battle snapshots before restore", () => {
    const session = createDuel({ seed: 144, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const targetUid = serializeDuel(session).state.cards[1]!.uid;
    const badAttacker = serializeDuel(session);
    const badTarget = serializeDuel(session);
    const badCurrentAttack = serializeDuel(session);
    const badReplayTargets = serializeDuel(session);
    const badPendingReplayTargets = serializeDuel(session);
    const badPendingBattle = serializeDuel(session);
    const badDamageOverrides = serializeDuel(session);
    const badDamageAmount = serializeDuel(session);
    badAttacker.state.currentAttack = { attackerUid: "missing" };
    badTarget.state.currentAttack = { attackerUid, targetUid: 7 as unknown as string };
    badCurrentAttack.state.currentAttack = { attackerUid, replayTargetCount: "two" as unknown as number };
    badReplayTargets.state.currentAttack = { attackerUid, replayTargetUids: [targetUid, "missing"] };
    badPendingReplayTargets.state.pendingBattle = { attackerUid, replayTargetUids: [targetUid, "missing"] };
    badPendingBattle.state.pendingBattle = { attackerUid, battleDamageOverrides: { 2: 100 } as unknown as Record<0 | 1, number> };
    badDamageOverrides.state.pendingBattle = { attackerUid, battleDamageOverrides: "100" as unknown as Record<0 | 1, number> };
    badDamageAmount.state.pendingBattle = { attackerUid, battleDamageOverrides: { 0: "100" as unknown as number } };

    expect(() => restoreDuel(badAttacker, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.attackerUid must reference a card");
    expect(() => restoreDuel(badTarget, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.targetUid must be a string");
    expect(() => restoreDuel(badCurrentAttack, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.replayTargetCount must be a number");
    expect(() => restoreDuel(badReplayTargets, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.replayTargetUids.1 must reference a card");
    expect(() => restoreDuel(badPendingReplayTargets, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.replayTargetUids.1 must reference a card");
    expect(() => restoreDuel(badPendingBattle, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.battleDamageOverrides must use player ids");
    expect(() => restoreDuel(badDamageOverrides, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.battleDamageOverrides must be an object");
    expect(() => restoreDuel(badDamageAmount, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.battleDamageOverrides.0 must be a number");
  });
});
