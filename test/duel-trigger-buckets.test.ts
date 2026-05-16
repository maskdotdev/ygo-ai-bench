import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { declineDuelPendingTrigger, shouldContinueTriggerSelection } from "#duel/effect-activation.js";
import { setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";
import { registerBucketTrigger, setupTriggerBucketFixture } from "./duel-trigger-fixtures.js";

describe("duel trigger buckets", () => {
  it("sets waitingFor from canonical active bucket order", () => {
    const session = createDuel({ seed: 30, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.pendingTriggers = [
      { id: "optional-first", player: 0, sourceUid, effectId: "optional", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "turnOptional" },
      { id: "mandatory-second", player: 1, sourceUid, effectId: "mandatory", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "opponentMandatory" },
    ];

    setWaitingForPendingTriggerBucket(session.state);

    expect(queryPublicState(session).pendingTriggerBuckets).toEqual([
      { triggerBucket: "opponentMandatory", player: 1, triggerIds: ["mandatory-second"] },
      { triggerBucket: "turnOptional", player: 0, triggerIds: ["optional-first"] },
    ]);
    expect(session.state.waitingFor).toBe(1);
  });

  it("rejects live trigger buckets that do not match the trigger player", () => {
    const session = createDuel({ seed: 31, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.pendingTriggers = [
      { id: "bad-opponent", player: 1, sourceUid, effectId: "bad", eventName: "customEvent", eventTriggerTiming: "if", triggerBucket: "turnOptional" },
    ];
    session.state.waitingFor = 1;

    expect(() => queryPublicState(session)).toThrow("Pending trigger bad-opponent bucket turnOptional does not match player 1");
    expect(() => getDuelLegalActions(session, 1)).toThrow("Pending trigger bad-opponent bucket turnOptional does not match player 1");
    expect(() => setWaitingForPendingTriggerBucket(session.state)).toThrow("Pending trigger bad-opponent bucket turnOptional does not match player 1");
  });

  it("orders simultaneous triggers by mandatory and turn-player buckets", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "300"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnMandatory = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const turnOptional = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const opponentMandatory = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    const opponentOptional = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(turnMandatory).toBeTruthy();
    expect(turnOptional).toBeTruthy();
    expect(opponentMandatory).toBeTruthy();
    expect(opponentOptional).toBeTruthy();

    registerEffect(session, {
      id: "opponent-optional-bucket",
      sourceUid: opponentOptional!.uid,
      controller: 1,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Opponent optional bucket resolved");
      },
    });
    registerEffect(session, {
      id: "turn-optional-bucket",
      sourceUid: turnOptional!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Turn optional bucket resolved");
      },
    });
    registerEffect(session, {
      id: "opponent-mandatory-bucket",
      sourceUid: opponentMandatory!.uid,
      controller: 1,
      event: "trigger",
      triggerEvent: "normalSummoned",
      optional: false,
      range: ["hand"],
      operation(ctx) {
        ctx.log("Opponent mandatory bucket resolved");
      },
    });
    registerEffect(session, {
      id: "turn-mandatory-bucket",
      sourceUid: turnMandatory!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      optional: false,
      range: ["hand"],
      operation(ctx) {
        ctx.log("Turn mandatory bucket resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    const result = applyAndAssert(session, summon!);

    expect(result.ok).toBe(true);
    expect(result.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual([
      "turn-mandatory-bucket",
      "opponent-mandatory-bucket",
      "turn-optional-bucket",
      "opponent-optional-bucket",
    ]);
    expect(result.state.pendingTriggers.map((trigger) => trigger.triggerBucket)).toEqual([
      "turnMandatory",
      "opponentMandatory",
      "turnOptional",
      "opponentOptional",
    ]);
    expect(result.state.waitingFor).toBe(0);
  });

  it("exposes all triggers in the active bucket before later buckets", () => {
    const { session, summoned, turnFirst, turnSecond, opponent } = setupTriggerBucketFixture();

    registerBucketTrigger(session, "first-turn-mandatory-bucket", turnFirst, 0, false);
    registerBucketTrigger(session, "opponent-later-mandatory-bucket", opponent, 1, false);
    registerBucketTrigger(session, "second-turn-mandatory-bucket", turnSecond, 0, false);

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon).toBeTruthy();
    const result = applyAndAssert(session, summon!);

    expect(result.ok).toBe(true);
    expect(result.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual([
      "first-turn-mandatory-bucket",
      "second-turn-mandatory-bucket",
      "opponent-later-mandatory-bucket",
    ]);
    expect(result.state.pendingTriggers.map((trigger) => trigger.triggerBucket)).toEqual([
      "turnMandatory",
      "turnMandatory",
      "opponentMandatory",
    ]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([
      "first-turn-mandatory-bucket",
      "second-turn-mandatory-bucket",
    ]);
    expect(queryPublicState(session).triggerOrderPrompt).toEqual({
      id: `${session.state.actionWindowId}:turnMandatory:0`,
      type: "orderTriggers",
      player: 0,
      triggerBucket: "turnMandatory",
      triggerIds: [
        result.state.pendingTriggers[0]!.id,
        result.state.pendingTriggers[1]!.id,
      ],
    });
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.triggerBucket)).toEqual([
      "turnMandatory",
      "turnMandatory",
    ]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const activate = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "first-turn-mandatory-bucket");
    expect(activate).toBeTruthy();
    const afterFirst = applyAndAssert(session, activate!);

    expect(afterFirst.ok).toBe(true);
    expect(afterFirst.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["second-turn-mandatory-bucket", "opponent-later-mandatory-bucket"]);
    expect(queryPublicState(session).triggerOrderPrompt).toBeUndefined();
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual(["second-turn-mandatory-bucket"]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
  });

  it("stops trigger selection when remaining triggers belong to a different event payload", () => {
    const session = createDuel({ seed: 32, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const sourceUid = session.state.cards.find((card) => card.code === "300")!.uid;
    const eventCardUid = session.state.cards.find((card) => card.code === "100")!.uid;
    session.state.chain = [
      {
        id: "chain-payload-first",
        player: 0,
        sourceUid,
        effectId: "first-payload-trigger",
        eventName: "customEvent",
        eventCode: 0x10000005,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: 64,
        eventReasonPlayer: 0,
        relatedEffectId: 101,
        eventUids: [eventCardUid],
        eventCardUid,
      },
    ];
    session.state.pendingTriggers = [
      {
        id: "second-payload",
        player: 0,
        sourceUid,
        effectId: "second-payload-trigger",
        eventName: "customEvent",
        eventTriggerTiming: "if",
        triggerBucket: "turnOptional",
        eventCode: 0x10000005,
        eventPlayer: 0,
        eventValue: 2,
        eventReason: 64,
        eventReasonPlayer: 0,
        relatedEffectId: 101,
        eventUids: [eventCardUid],
        eventCardUid,
      },
    ];
    session.state.waitingFor = 0;

    expect(shouldContinueTriggerSelection(session.state)).toBe(false);
    expect(queryPublicState(session).windowKind).toBe("chainResponse");
    expect(queryPublicState(session).pendingTriggerBuckets).toEqual([
      { triggerBucket: "turnOptional", player: 0, triggerIds: ["second-payload"] },
    ]);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateTrigger" && action.effectId === "second-payload-trigger")).toBe(false);
  });

  it("restores chain windows without exposing later-payload trigger buckets until the chain resolves", () => {
    const session = createDuel({ seed: 132, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const chainSourceUid = session.state.cards.find((card) => card.code === "300")!.uid;
    const triggerSourceUid = session.state.cards.find((card) => card.code === "500")!.uid;
    const eventCardUid = session.state.cards.find((card) => card.code === "100")!.uid;
    const withOperation = (effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition => ({
      ...effect,
      operation(ctx) {
        ctx.log(`${effect.id} resolved`);
      },
    });
    registerEffect(session, withOperation({
      id: "restored-chain-first-payload",
      registryKey: "restored-chain-first-payload",
      sourceUid: chainSourceUid,
      controller: 0,
      event: "quick",
      range: ["hand"],
    }));
    registerEffect(session, withOperation({
      id: "restored-later-payload-trigger",
      registryKey: "restored-later-payload-trigger",
      sourceUid: triggerSourceUid,
      controller: 0,
      event: "trigger",
      triggerEvent: "customEvent",
      range: ["hand"],
    }));
    session.state.chain = [
      {
        id: "restored-chain-payload-first",
        player: 0,
        sourceUid: chainSourceUid,
        effectId: "restored-chain-first-payload",
        eventName: "customEvent",
        eventCode: 0x10000005,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [eventCardUid],
        eventCardUid,
      },
    ];
    session.state.pendingTriggers = [
      {
        id: "restored-second-payload",
        player: 0,
        sourceUid: triggerSourceUid,
        effectId: "restored-later-payload-trigger",
        eventName: "customEvent",
        eventTriggerTiming: "if",
        triggerBucket: "turnOptional",
        eventCode: 0x10000005,
        eventPlayer: 0,
        eventValue: 2,
        eventUids: [eventCardUid],
        eventCardUid,
      },
    ];
    session.state.waitingFor = 1;

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "restored-chain-first-payload": withOperation,
      "restored-later-payload-trigger": withOperation,
    });
    expect(queryPublicState(restored).windowKind).toBe("chainResponse");
    expect(queryPublicState(restored).pendingTriggerBuckets).toEqual([
      { triggerBucket: "turnOptional", player: 0, triggerIds: ["restored-second-payload"] },
    ]);
    expect(getDuelLegalActions(restored, 0)).toHaveLength(0);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "passChain")).toBe(true);

    const opponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeTruthy();
    const afterOpponentPass = applyAndAssert(restored, opponentPass!);
    expect(afterOpponentPass.ok).toBe(true);
    expect(queryPublicState(restored).windowKind).toBe("chainResponse");
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "activateTrigger" && action.effectId === "restored-later-payload-trigger")).toBe(false);

    const turnPass = getDuelLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeTruthy();
    const result = applyAndAssert(restored, turnPass!);

    expect(result.ok).toBe(true);
    expect(queryPublicState(restored).windowKind).toBe("triggerBucket");
    expect(restored.state.chainPasses).toEqual([]);
    expect(restored.state.waitingFor).toBe(0);
    expect(restored.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restored-later-payload-trigger"]);
    expect(getDuelLegalActions(restored, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual(["restored-later-payload-trigger"]);

    const restoredTriggerBucket = restoreDuel(serializeDuel(restored), createCardReader(cards), {
      "restored-chain-first-payload": withOperation,
      "restored-later-payload-trigger": withOperation,
    });
    expect(restoredTriggerBucket.state.pendingTriggers).toEqual(restored.state.pendingTriggers);
    expect(queryPublicState(restoredTriggerBucket).windowKind).toBe("triggerBucket");
    expect(queryPublicState(restoredTriggerBucket).pendingTriggerBuckets).toEqual([
      { triggerBucket: "turnOptional", player: 0, triggerIds: ["restored-second-payload"] },
    ]);
    expect(getDuelLegalActions(restoredTriggerBucket, 1)).toHaveLength(0);
    const restoredTrigger = getDuelLegalActions(restoredTriggerBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restored-later-payload-trigger");
    expect(restoredTrigger).toBeTruthy();
    const restoredTriggerResult = applyAndAssert(restoredTriggerBucket, restoredTrigger!);
    expect(restoredTriggerResult.ok).toBe(true);
    expect(restoredTriggerBucket.state.pendingTriggers).toEqual([]);
    expect(restoredTriggerBucket.state.chain.map((link) => link.effectId)).toEqual(["restored-later-payload-trigger"]);
    expect(restoredTriggerBucket.state.chain[0]).toMatchObject({
      eventName: "customEvent",
      eventCardUid,
      eventValue: 2,
    });
    const staleRestoredTrigger = applyResponse(restoredTriggerBucket, restoredTrigger!);
    expect(staleRestoredTrigger.ok).toBe(false);
    expect(staleRestoredTrigger.error).toContain("Response is not currently legal");
    expect(staleRestoredTrigger.state.actionWindowId).toBe(restoredTriggerBucket.state.actionWindowId);
    expect(staleRestoredTrigger.legalActions).toEqual(getDuelLegalActions(restoredTriggerBucket, restoredTriggerResult.state.waitingFor!));
    expect(staleRestoredTrigger.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTriggerBucket, restoredTriggerResult.state.waitingFor!));
    expect(staleRestoredTrigger.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleRestoredTrigger.legalActions);

    const staleTurnPass = applyResponse(restored, turnPass!);
    expect(staleTurnPass.ok).toBe(false);
    expect(staleTurnPass.error).toContain("Response is not currently legal");
    expect(staleTurnPass.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleTurnPass.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleTurnPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleTurnPass.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleTurnPass.legalActions);
  });

  it("continues trigger selection when only trigger timing differs", () => {
    const session = createDuel({ seed: 332, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: [] },
    });
    startDuel(session);
    const eventCardUid = session.state.cards.find((card) => card.code === "100")!.uid;
    const whenSourceUid = session.state.cards.find((card) => card.code === "300")!.uid;
    const ifSourceUid = session.state.cards.find((card) => card.code === "500")!.uid;
    session.state.chain = [
      {
        id: "chain-trigger-timing",
        player: 0,
        sourceUid: whenSourceUid,
        effectId: "when-trigger",
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid,
        eventTriggerTiming: "when",
      },
    ];
    session.state.pendingTriggers = [
      {
        id: "if-trigger",
        player: 0,
        sourceUid: ifSourceUid,
        effectId: "if-trigger",
        eventName: "sentToGraveyard",
        triggerBucket: "turnOptional",
        eventCode: 1014,
        eventCardUid,
        eventTriggerTiming: "if",
      },
    ];
    registerEffect(session, {
      id: "if-trigger",
      sourceUid: ifSourceUid,
      controller: 0,
      event: "trigger",
      triggerEvent: "sentToGraveyard",
      triggerTiming: "if",
      range: ["hand"],
      operation(ctx) {
        ctx.log("if-trigger resolved");
      },
    });
    session.state.waitingFor = 0;

    expect(shouldContinueTriggerSelection(session.state)).toBe(true);
    expect(queryPublicState(session).windowKind).toBe("triggerBucket");
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateTrigger" && action.effectId === "if-trigger")).toBe(true);
  });

  it("declines optional trigger buckets without exposing later buckets early", () => {
    const { session, summoned, turnFirst, turnSecond, opponent } = setupTriggerBucketFixture();

    registerBucketTrigger(session, "first-turn-optional-bucket", turnFirst, 0);
    registerBucketTrigger(session, "opponent-later-optional-bucket", opponent, 1);
    registerBucketTrigger(session, "second-turn-optional-bucket", turnSecond, 0);

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon).toBeTruthy();
    const result = applyAndAssert(session, summon!);

    expect(result.ok).toBe(true);
    expect(result.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual([
      "first-turn-optional-bucket",
      "second-turn-optional-bucket",
      "opponent-later-optional-bucket",
    ]);
    expect(result.state.pendingTriggers.map((trigger) => trigger.triggerBucket)).toEqual([
      "turnOptional",
      "turnOptional",
      "opponentOptional",
    ]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual([
      "first-turn-optional-bucket",
      "second-turn-optional-bucket",
    ]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "declineTrigger").map((action) => action.triggerBucket)).toEqual([
      "turnOptional",
      "turnOptional",
    ]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const declineFirst = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger" && action.effectId === "first-turn-optional-bucket");
    expect(declineFirst).toBeTruthy();
    const afterFirstDecline = applyAndAssert(session, declineFirst!);

    expect(afterFirstDecline.ok).toBe(true);
    expect(afterFirstDecline.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["second-turn-optional-bucket", "opponent-later-optional-bucket"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual(["second-turn-optional-bucket"]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const declineSecond = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger" && action.effectId === "second-turn-optional-bucket");
    expect(declineSecond).toBeTruthy();
    const afterSecondDecline = applyAndAssert(session, declineSecond!);

    expect(afterSecondDecline.ok).toBe(true);
    expect(afterSecondDecline.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["opponent-later-optional-bucket"]);
    expect(afterSecondDecline.state.waitingFor).toBe(1);
    expect(getDuelLegalActions(session, 0)).toHaveLength(0);
    expect(getDuelLegalActions(session, 1).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual(["opponent-later-optional-bucket"]);
  });

  it("rejects direct trigger handling outside the active bucket", () => {
    const { session, summoned, turnFirst, opponent } = setupTriggerBucketFixture();

    registerBucketTrigger(session, "active-turn-optional-bucket", turnFirst, 0);
    registerBucketTrigger(session, "later-opponent-optional-bucket", opponent, 1);

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon).toBeTruthy();
    applyAndAssert(session, summon!);
    const laterTrigger = session.state.pendingTriggers.find((trigger) => trigger.effectId === "later-opponent-optional-bucket");
    expect(laterTrigger).toBeTruthy();

    expect(() => declineDuelPendingTrigger(session, 1, laterTrigger!.id, "opponentOptional")).toThrow(
      `Trigger ${laterTrigger!.id} is not pending in the active opponentOptional bucket for player 1`,
    );
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual([
      "active-turn-optional-bucket",
      "later-opponent-optional-bucket",
    ]);
  });

  it("rejects direct trigger handling for later same-player buckets without consuming them", () => {
    const { session, summoned, turnFirst, turnSecond } = setupTriggerBucketFixture();

    registerBucketTrigger(session, "active-turn-mandatory-bucket", turnFirst, 0, false);
    registerBucketTrigger(session, "later-turn-optional-bucket", turnSecond, 0);

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon).toBeTruthy();
    applyAndAssert(session, summon!);
    const laterTrigger = session.state.pendingTriggers.find((trigger) => trigger.effectId === "later-turn-optional-bucket");
    expect(laterTrigger).toBeTruthy();

    expect(() => declineDuelPendingTrigger(session, 0, laterTrigger!.id, "turnMandatory")).toThrow(`Trigger ${laterTrigger!.id} is not pending in bucket turnMandatory`);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual([
      "active-turn-mandatory-bucket",
      "later-turn-optional-bucket",
    ]);
  });

  it("activates optional trigger buckets without exposing later buckets early", () => {
    const { session, summoned, turnFirst, turnSecond, opponent } = setupTriggerBucketFixture();

    registerBucketTrigger(session, "first-turn-optional-activation", turnFirst, 0);
    registerBucketTrigger(session, "opponent-later-optional-activation", opponent, 1);
    registerBucketTrigger(session, "second-turn-optional-activation", turnSecond, 0);

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon).toBeTruthy();
    const result = applyAndAssert(session, summon!);

    expect(result.ok).toBe(true);
    expect(result.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual([
      "first-turn-optional-activation",
      "second-turn-optional-activation",
      "opponent-later-optional-activation",
    ]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([
      "first-turn-optional-activation",
      "second-turn-optional-activation",
    ]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const activateFirst = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "first-turn-optional-activation");
    expect(activateFirst).toBeTruthy();
    const afterFirstActivation = applyAndAssert(session, activateFirst!);

    expect(afterFirstActivation.ok).toBe(true);
    expect(afterFirstActivation.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["second-turn-optional-activation", "opponent-later-optional-activation"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual(["second-turn-optional-activation"]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const activateSecond = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "second-turn-optional-activation");
    expect(activateSecond).toBeTruthy();
    const afterSecondActivation = applyAndAssert(session, activateSecond!);

    expect(afterSecondActivation.ok).toBe(true);
    expect(afterSecondActivation.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["opponent-later-optional-activation"]);
    expect(afterSecondActivation.state.waitingFor).toBe(1);
    expect(getDuelLegalActions(session, 0)).toHaveLength(0);
    expect(getDuelLegalActions(session, 1).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual(["opponent-later-optional-activation"]);
  });

  it("restores active trigger buckets without exposing later buckets early", () => {
    const { session, summoned, turnFirst, turnSecond, opponent } = setupTriggerBucketFixture();
    const withOperation = (effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition => ({
      ...effect,
      operation(ctx) {
        ctx.log(`${effect.id} resolved`);
      },
    });

    registerEffect(session, withOperation({
      id: "first-restored-turn-optional",
      registryKey: "first-restored-turn-optional",
      sourceUid: turnFirst.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
    }));
    registerEffect(session, withOperation({
      id: "second-restored-turn-optional",
      registryKey: "second-restored-turn-optional",
      sourceUid: turnSecond.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
    }));
    registerEffect(session, withOperation({
      id: "opponent-restored-later-optional",
      registryKey: "opponent-restored-later-optional",
      sourceUid: opponent.uid,
      controller: 1,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
    }));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon).toBeTruthy();
    applyAndAssert(session, summon!);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual([
      "first-restored-turn-optional",
      "second-restored-turn-optional",
      "opponent-restored-later-optional",
    ]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "first-restored-turn-optional": withOperation,
      "second-restored-turn-optional": withOperation,
      "opponent-restored-later-optional": withOperation,
    });

    expect(restored.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(queryPublicState(restored).triggerOrderPrompt).toEqual({
      id: `${restored.state.actionWindowId}:turnOptional:0`,
      type: "orderTriggers",
      player: 0,
      triggerBucket: "turnOptional",
      triggerIds: [
        restored.state.pendingTriggers[0]!.id,
        restored.state.pendingTriggers[1]!.id,
      ],
    });
    expect(getDuelLegalActions(restored, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual([
      "first-restored-turn-optional",
      "second-restored-turn-optional",
    ]);
    expect(getGroupedDuelLegalActions(restored, 0).map((group) => ({
      label: group.label,
      windowId: group.windowId,
      windowKind: group.windowKind,
      triggerBucket: group.triggerBucket,
      triggerOrderPrompt: group.triggerOrderPrompt,
      effectIds: group.actions.map((action) => "effectId" in action ? action.effectId : undefined),
    }))).toEqual([
      {
        label: "Trigger Activations",
        windowId: queryPublicState(restored).actionWindowId,
        windowKind: "triggerBucket",
        triggerBucket: { triggerBucket: "turnOptional", player: 0, triggerIds: queryPublicState(restored).triggerOrderPrompt!.triggerIds },
        triggerOrderPrompt: queryPublicState(restored).triggerOrderPrompt,
        effectIds: ["first-restored-turn-optional", "second-restored-turn-optional"],
      },
      {
        label: "Trigger Declines",
        windowId: queryPublicState(restored).actionWindowId,
        windowKind: "triggerBucket",
        triggerBucket: { triggerBucket: "turnOptional", player: 0, triggerIds: queryPublicState(restored).triggerOrderPrompt!.triggerIds },
        triggerOrderPrompt: queryPublicState(restored).triggerOrderPrompt,
        effectIds: ["first-restored-turn-optional", "second-restored-turn-optional"],
      },
    ]);
    expect(getDuelLegalActions(restored, 1)).toHaveLength(0);

    const activateFirst = getDuelLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.effectId === "first-restored-turn-optional");
    expect(activateFirst).toBeTruthy();
    const firstResult = applyAndAssert(restored, activateFirst!);
    expect(restored.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual([
      "second-restored-turn-optional",
      "opponent-restored-later-optional",
    ]);
    expect(getDuelLegalActions(restored, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual(["second-restored-turn-optional"]);
    expect(getDuelLegalActions(restored, 1)).toHaveLength(0);
    const staleActivation = applyResponse(restored, activateFirst!);
    expect(staleActivation.ok).toBe(false);
    expect(staleActivation.error).toContain("Response is not currently legal");
    expect(staleActivation.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleActivation.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleActivation.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleActivation.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleActivation.legalActions);
    expect(restored.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual([
      "second-restored-turn-optional",
      "opponent-restored-later-optional",
    ]);

    const activateSecond = getDuelLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.effectId === "second-restored-turn-optional");
    expect(activateSecond).toBeTruthy();
    const secondResult = applyAndAssert(restored, activateSecond!);
    expect(restored.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["opponent-restored-later-optional"]);
    expect(restored.state.waitingFor).toBe(1);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restored), createCardReader(cards), {
      "first-restored-turn-optional": withOperation,
      "second-restored-turn-optional": withOperation,
      "opponent-restored-later-optional": withOperation,
    });
    expect(restoredOpponentBucket.state.pendingTriggers).toEqual(restored.state.pendingTriggers);
    expect(getDuelLegalActions(restoredOpponentBucket, 0)).toHaveLength(0);
    expect(getDuelLegalActions(restoredOpponentBucket, 1).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual(["opponent-restored-later-optional"]);
    expect(getDuelLegalActions(restoredOpponentBucket, 1).filter((action) => action.type === "declineTrigger").map((action) => action.effectId)).toEqual(["opponent-restored-later-optional"]);
    expect(getGroupedDuelLegalActions(restoredOpponentBucket, 1).map((group) => ({
      label: group.label,
      windowId: group.windowId,
      windowKind: group.windowKind,
      effectIds: group.actions.map((action) => "effectId" in action ? action.effectId : undefined),
    }))).toEqual([
      { label: "Trigger Activations", windowId: queryPublicState(restoredOpponentBucket).actionWindowId, windowKind: "triggerBucket", effectIds: ["opponent-restored-later-optional"] },
      { label: "Trigger Declines", windowId: queryPublicState(restoredOpponentBucket).actionWindowId, windowKind: "triggerBucket", effectIds: ["opponent-restored-later-optional"] },
    ]);
    expect(getGroupedDuelLegalActions(restoredOpponentBucket, 1).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpponentBucket, 1));
    const opponentActivation = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "activateTrigger" && action.effectId === "opponent-restored-later-optional");
    expect(opponentActivation).toBeTruthy();
    const opponentActivated = applyAndAssert(restoredOpponentBucket, opponentActivation!);
    expect(opponentActivated.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [] });
    expect(restoredOpponentBucket.state.chainPasses).toEqual([]);
    expect(restoredOpponentBucket.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "first-restored-turn-optional resolved",
      "second-restored-turn-optional resolved",
      "opponent-restored-later-optional resolved",
    ]));
    expect(restoredOpponentBucket.state.pendingTriggers).toEqual([]);
    expect(queryPublicState(restoredOpponentBucket).pendingTriggerBuckets).toEqual([]);
    const restoredAfterOpponentResolution = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), {
      "first-restored-turn-optional": withOperation,
      "second-restored-turn-optional": withOperation,
      "opponent-restored-later-optional": withOperation,
    });
    expect(queryPublicState(restoredAfterOpponentResolution)).toMatchObject({ waitingFor: 0, windowKind: "open", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredAfterOpponentResolution.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restoredAfterOpponentResolution, 0).map((action) => action.type)).toEqual(getDuelLegalActions(restoredOpponentBucket, 0).map((action) => action.type));
    expect(getGroupedDuelLegalActions(restoredAfterOpponentResolution, 0).map((group) => group.label)).toEqual(getGroupedDuelLegalActions(restoredOpponentBucket, 0).map((group) => group.label));
    expect(getDuelLegalActions(restoredAfterOpponentResolution, 1)).toEqual([]);
    const staleOpponentActivation = applyResponse(restoredOpponentBucket, opponentActivation!);
    expect(staleOpponentActivation.ok).toBe(false);
    expect(staleOpponentActivation.error).toContain("Response is not currently legal");
    expect(staleOpponentActivation.state.actionWindowId).toBe(restoredOpponentBucket.state.actionWindowId);
    expect(staleOpponentActivation.legalActions).toEqual(getDuelLegalActions(restoredOpponentBucket, opponentActivated.state.waitingFor!));
    expect(staleOpponentActivation.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentBucket, opponentActivated.state.waitingFor!));
    expect(staleOpponentActivation.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleOpponentActivation.legalActions);
  });

  it("restores optional trigger decline actions and applies the restored decline", () => {
    const { session, summoned, turnFirst, turnSecond } = setupTriggerBucketFixture();
    const withOperation = (effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition => ({
      ...effect,
      operation(ctx) {
        ctx.log(`${effect.id} resolved`);
      },
    });

    registerEffect(session, withOperation({
      id: "first-restored-decline-optional",
      registryKey: "first-restored-decline-optional",
      sourceUid: turnFirst.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
    }));
    registerEffect(session, withOperation({
      id: "second-restored-decline-optional",
      registryKey: "second-restored-decline-optional",
      sourceUid: turnSecond.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
    }));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon).toBeTruthy();
    applyAndAssert(session, summon!);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "first-restored-decline-optional": withOperation,
      "second-restored-decline-optional": withOperation,
    });
    expect(restored.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    const decline = getDuelLegalActions(restored, 0).find((action) => action.type === "declineTrigger" && action.effectId === "first-restored-decline-optional");
    expect(decline).toBeTruthy();

    const staleBeforeDecline = applyResponse(restored, { ...decline!, windowId: decline!.windowId! - 1 });
    expect(staleBeforeDecline.ok).toBe(false);
    expect(staleBeforeDecline.error).toContain("Response is not currently legal");
    expect(staleBeforeDecline.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeDecline.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleBeforeDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleBeforeDecline.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeDecline.legalActions);

    const result = applyAndAssert(restored, decline!);
    expect(restored.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["second-restored-decline-optional"]);
    expect(getDuelLegalActions(restored, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual(["second-restored-decline-optional"]);
    expect(restored.state.log.some((entry) => entry.detail === "first-restored-decline-optional resolved")).toBe(false);
    const staleDecline = applyResponse(restored, decline!);
    expect(staleDecline.ok).toBe(false);
    expect(staleDecline.error).toContain("Response is not currently legal");
    expect(staleDecline.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleDecline.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(staleDecline.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleDecline.legalActions);
    expect(restored.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["second-restored-decline-optional"]);
  });

  it("restores mandatory bucket handoff without adding decline actions", () => {
    const { session, summoned, turnFirst, turnSecond, opponent } = setupTriggerBucketFixture();
    const withOperation = (effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition => ({
      ...effect,
      operation(ctx) {
        ctx.log(`${effect.id} resolved`);
      },
    });

    registerEffect(session, withOperation({
      id: "first-restored-turn-mandatory",
      registryKey: "first-restored-turn-mandatory",
      sourceUid: turnFirst.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      optional: false,
      range: ["hand"],
    }));
    registerEffect(session, withOperation({
      id: "second-restored-turn-mandatory",
      registryKey: "second-restored-turn-mandatory",
      sourceUid: turnSecond.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      optional: false,
      range: ["hand"],
    }));
    registerEffect(session, withOperation({
      id: "opponent-restored-mandatory",
      registryKey: "opponent-restored-mandatory",
      sourceUid: opponent.uid,
      controller: 1,
      event: "trigger",
      triggerEvent: "normalSummoned",
      optional: false,
      range: ["hand"],
    }));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon).toBeTruthy();
    applyAndAssert(session, summon!);

    for (const effectId of ["first-restored-turn-mandatory", "second-restored-turn-mandatory"]) {
      const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === effectId);
      expect(action).toBeTruthy();
      applyAndAssert(session, action!);
    }
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["opponent-restored-mandatory"]);
    expect(session.state.waitingFor).toBe(1);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "first-restored-turn-mandatory": withOperation,
      "second-restored-turn-mandatory": withOperation,
      "opponent-restored-mandatory": withOperation,
    });
    expect(restored.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(getDuelLegalActions(restored, 0)).toHaveLength(0);
    expect(getDuelLegalActions(restored, 1).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual(["opponent-restored-mandatory"]);
    expect(getDuelLegalActions(restored, 1).some((action) => action.type === "declineTrigger")).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 1).map((group) => ({
      label: group.label,
      windowId: group.windowId,
      windowKind: group.windowKind,
      effectIds: group.actions.map((action) => "effectId" in action ? action.effectId : undefined),
    }))).toEqual([
      { label: "Trigger Activations", windowId: queryPublicState(restored).actionWindowId, windowKind: "triggerBucket", effectIds: ["opponent-restored-mandatory"] },
    ]);
    const activation = getDuelLegalActions(restored, 1).find((action) => action.type === "activateTrigger" && action.effectId === "opponent-restored-mandatory");
    expect(activation).toBeTruthy();
    const staleBeforeActivation = applyResponse(restored, { ...activation!, windowId: activation!.windowId! - 1 });
    expect(staleBeforeActivation.ok).toBe(false);
    expect(staleBeforeActivation.error).toContain("Response is not currently legal");
    expect(staleBeforeActivation.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleBeforeActivation.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(staleBeforeActivation.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
    expect(staleBeforeActivation.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeActivation.legalActions);

    const activated = applyAndAssert(restored, activation!);
    expect(restored.state.pendingTriggers).toEqual([]);
    const staleActivation = applyResponse(restored, activation!);
    expect(staleActivation.ok).toBe(false);
    expect(staleActivation.error).toContain("Response is not currently legal");
    expect(staleActivation.state.actionWindowId).toBe(restored.state.actionWindowId);
    expect(staleActivation.legalActions).toEqual(getDuelLegalActions(restored, activated.state.waitingFor!));
    expect(staleActivation.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, activated.state.waitingFor!));
    expect(staleActivation.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleActivation.legalActions);
  });

  it("prunes restored pending triggers when their callback effect is unavailable", () => {
    const { session, summoned, turnFirst, turnSecond } = setupTriggerBucketFixture();
    const withOperation = (effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition => ({
      ...effect,
      operation(ctx) {
        ctx.log(`${effect.id} resolved`);
      },
    });

    registerEffect(session, withOperation({
      id: "missing-restored-trigger",
      registryKey: "missing-restored-trigger",
      sourceUid: turnFirst.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
    }));
    registerEffect(session, withOperation({
      id: "available-restored-trigger",
      registryKey: "available-restored-trigger",
      sourceUid: turnSecond.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
    }));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned.uid);
    expect(summon).toBeTruthy();
    applyAndAssert(session, summon!);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["missing-restored-trigger", "available-restored-trigger"]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {
      "available-restored-trigger": withOperation,
    });

    expect(restored.state.effects.map((effect) => effect.id)).toEqual(["available-restored-trigger"]);
    expect(restored.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["available-restored-trigger"]);
    expect(restored.state.waitingFor).toBe(0);
    expect(getDuelLegalActions(restored, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual(["available-restored-trigger"]);
    expect(getDuelLegalActions(restored, 0).some((action) => action.type === "activateTrigger" && action.effectId === "missing-restored-trigger")).toBe(false);
    expect(getGroupedDuelLegalActions(restored, 0).map((group) => ({
      label: group.label,
      windowId: group.windowId,
      windowKind: group.windowKind,
      triggerBucket: group.triggerBucket,
      effectIds: group.actions.map((action) => "effectId" in action ? action.effectId : undefined),
    }))).toEqual([
      {
        label: "Trigger Activations",
        windowId: queryPublicState(restored).actionWindowId,
        windowKind: "triggerBucket",
        triggerBucket: { triggerBucket: "turnOptional", player: 0, triggerIds: [restored.state.pendingTriggers[0]!.id] },
        effectIds: ["available-restored-trigger"],
      },
      {
        label: "Trigger Declines",
        windowId: queryPublicState(restored).actionWindowId,
        windowKind: "triggerBucket",
        triggerBucket: { triggerBucket: "turnOptional", player: 0, triggerIds: [restored.state.pendingTriggers[0]!.id] },
        effectIds: ["available-restored-trigger"],
      },
    ]);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
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
