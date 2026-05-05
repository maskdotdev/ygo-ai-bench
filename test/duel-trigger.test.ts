import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  specialSummonDuelCard,
  startDuel,
} from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";
import { activateTriggerByEffect, setupTriggerCountFixture } from "./duel-trigger-fixtures.js";

describe("duel triggers", () => {
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

  it("lets quick effects respond to trigger activations", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    expect(quickSource).toBeTruthy();

    registerEffect(session, {
      id: "chainable-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Trigger saw ${ctx.eventCard?.name ?? "missing card"}`);
      },
    });
    registerEffect(session, {
      id: "trigger-response",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Quick response to trigger resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    const summonedState = applyResponse(session, summon!).state;
    expect(summonedState.pendingTriggers).toHaveLength(1);
    expect(summonedState.waitingFor).toBe(0);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).map((action) => action.type)).toEqual(["activateTrigger", "declineTrigger"]);

    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "chainable-trigger");
    expect(trigger).toBeTruthy();
    const opened = applyResponse(session, trigger!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.pendingTriggers).toHaveLength(0);
    expect(opened.state.waitingFor).toBe(1);
    expect(opened.state.log.some((entry) => entry.detail.includes("Trigger saw"))).toBe(false);
    expect(getDuelLegalActions(session, 0)).toHaveLength(0);

    const response = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "trigger-response");
    expect(response).toBeTruthy();
    const resolved = applyResponse(session, response!);
    const quickLog = resolved.state.log.find((entry) => entry.detail === "Quick response to trigger resolved");
    const triggerLog = resolved.state.log.find((entry) => entry.detail.includes("Trigger saw Normal Test Monster"));

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(quickLog).toBeTruthy();
    expect(triggerLog).toBeTruthy();
    expect(quickLog!.step).toBeLessThan(triggerLog!.step);
  });

  it("holds sibling pending triggers behind the open trigger chain window", () => {
    const session = createDuel({ seed: 2, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(summoned).toBeTruthy();
    expect(firstSource).toBeTruthy();
    expect(secondSource).toBeTruthy();
    expect(quickSource).toBeTruthy();

    registerEffect(session, {
      id: "first-chain-window-trigger",
      sourceUid: firstSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("First chain window trigger resolved");
      },
    });
    registerEffect(session, {
      id: "second-held-trigger",
      sourceUid: secondSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Second held trigger resolved");
      },
    });
    registerEffect(session, {
      id: "opponent-chain-window-quick",
      sourceUid: quickSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Opponent chain window quick resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["first-chain-window-trigger", "second-held-trigger"]);

    const firstTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "first-chain-window-trigger");
    expect(firstTrigger).toBeTruthy();
    const opened = applyResponse(session, firstTrigger!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.waitingFor).toBe(0);
    expect(opened.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["second-held-trigger"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger").map((action) => action.effectId)).toEqual(["second-held-trigger"]);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);

    const secondTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "second-held-trigger");
    expect(secondTrigger).toBeTruthy();
    const openedChain = applyResponse(session, secondTrigger!);
    expect(openedChain.ok).toBe(true);
    expect(openedChain.state.pendingTriggers).toHaveLength(0);
    expect(openedChain.state.waitingFor).toBe(1);

    const pass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(pass).toBeTruthy();
    const resolved = applyResponse(session, pass!);
    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(resolved.state.pendingTriggers).toHaveLength(0);
  });

  it("offers the trigger controller quick responses when the opponent cannot chain", () => {
    const session = createDuel({ seed: 3, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const quickSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    expect(quickSource).toBeTruthy();

    registerEffect(session, {
      id: "self-chainable-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Self chainable trigger resolved");
      },
    });
    registerEffect(session, {
      id: "self-quick-response",
      sourceUid: quickSource!.uid,
      controller: 0,
      event: "quick",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Self quick response resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);

    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "self-chainable-trigger");
    expect(trigger).toBeTruthy();
    const opened = applyResponse(session, trigger!);

    expect(opened.ok).toBe(true);
    expect(opened.state.chain).toHaveLength(1);
    expect(opened.state.waitingFor).toBe(0);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).map((action) => action.type)).toEqual(["activateEffect", "passChain"]);

    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "self-quick-response");
    expect(quick).toBeTruthy();
    const resolved = applyResponse(session, quick!);
    const quickLog = resolved.state.log.find((entry) => entry.detail === "Self quick response resolved");
    const triggerLog = resolved.state.log.find((entry) => entry.detail === "Self chainable trigger resolved");

    expect(resolved.ok).toBe(true);
    expect(resolved.state.chain).toHaveLength(0);
    expect(quickLog).toBeTruthy();
    expect(triggerLog).toBeTruthy();
    expect(quickLog!.step).toBeLessThan(triggerLog!.step);
  });

  it("allows optional trigger effects to be declined", () => {
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
      id: "optional-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("Declined effect should not resolve");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);

    const decline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger");
    expect(decline).toBeTruthy();
    const result = applyResponse(session, decline!);

    expect(result.ok).toBe(true);
    expect(result.state.pendingTriggers).toHaveLength(0);
    expect(result.state.cards.find((card) => card.uid === triggerSource!.uid)?.location).toBe("hand");
    expect(result.state.log.some((entry) => entry.detail.includes("Declined effect should not resolve"))).toBe(false);
    expect(result.state.log.some((entry) => entry.action === "declineTrigger" && entry.detail === "optional-trigger")).toBe(true);
  });

  it("does not expose decline actions for mandatory trigger effects", () => {
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
      id: "mandatory-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      optional: false,
      range: ["hand"],
      operation(ctx) {
        ctx.log("Mandatory trigger resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);

    const actions = getDuelLegalActions(session, 0);
    expect(actions.map((action) => action.type)).toEqual(["activateTrigger"]);
    expect(actions[0]).toMatchObject({ effectId: "mandatory-trigger" });
    expect(
      applyResponse(session, {
        type: "declineTrigger",
        player: 0,
        triggerId: session.state.pendingTriggers[0]!.id,
        triggerBucket: session.state.pendingTriggers[0]!.triggerBucket,
        uid: triggerSource!.uid,
        effectId: "mandatory-trigger",
        label: "Illegal decline",
      }).ok,
    ).toBe(false);
  });

  it("lets a player choose the order of multiple pending triggers", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const publicState = queryPublicState(session);
    const summoned = publicState.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstSource = publicState.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const secondSource = publicState.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(summoned).toBeTruthy();
    expect(firstSource).toBeTruthy();
    expect(secondSource).toBeTruthy();

    registerEffect(session, {
      id: "first-trigger",
      sourceUid: firstSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("First trigger resolved");
      },
    });
    registerEffect(session, {
      id: "second-trigger",
      sourceUid: secondSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.moveCard(ctx.source.uid, "graveyard");
        ctx.log("Second trigger resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    const summonResult = applyResponse(session, summon!);
    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.pendingTriggers).toHaveLength(2);

    const second = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "second-trigger");
    expect(second).toBeTruthy();
    const secondResult = applyResponse(session, second!);
    expect(secondResult.ok).toBe(true);
    expect(secondResult.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["first-trigger"]);
    expect(secondResult.state.chain.map((link) => link.effectId)).toEqual(["second-trigger"]);
    expect(secondResult.state.cards.find((card) => card.uid === secondSource!.uid)?.location).toBe("hand");
    expect(secondResult.state.cards.find((card) => card.uid === firstSource!.uid)?.location).toBe("hand");
  });

  it("orders simultaneous cross-player triggers by turn-player priority", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnPlayerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const opponentSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(summoned).toBeTruthy();
    expect(turnPlayerSource).toBeTruthy();
    expect(opponentSource).toBeTruthy();

    registerEffect(session, {
      id: "opponent-simultaneous-trigger",
      sourceUid: opponentSource!.uid,
      controller: 1,
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log("Opponent simultaneous trigger resolved");
      },
    });
    registerEffect(session, {
      id: "turn-player-simultaneous-trigger",
      sourceUid: turnPlayerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "normalSummoned",
      optional: false,
      range: ["hand"],
      operation(ctx) {
        ctx.log("Turn-player simultaneous trigger resolved");
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeTruthy();
    const summonResult = applyResponse(session, summon!);

    expect(summonResult.ok).toBe(true);
    expect(summonResult.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["turn-player-simultaneous-trigger", "opponent-simultaneous-trigger"]);
    expect(summonResult.state.waitingFor).toBe(0);
    expect(getDuelLegalActions(session, 1)).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).map((action) => action.type)).toEqual(["activateTrigger"]);

    const activate = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "turn-player-simultaneous-trigger");
    expect(activate).toBeTruthy();
    const declined = applyResponse(session, activate!);

    expect(declined.ok).toBe(true);
    expect(declined.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["opponent-simultaneous-trigger"]);
    expect(declined.state.waitingFor).toBe(1);
    expect(getDuelLegalActions(session, 0)).toHaveLength(0);
    expect(getDuelLegalActions(session, 1).some((action) => action.type === "activateTrigger" && action.effectId === "opponent-simultaneous-trigger")).toBe(true);
  });

  it("suppresses once-per-turn triggers after first activation", () => {
    const { session, firstSummon, triggerSource, secondSummon } = setupTriggerCountFixture();

    registerEffect(session, {
      id: "once-per-turn-special-trigger",
      sourceUid: triggerSource.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      oncePerTurn: true,
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Once trigger saw ${ctx.eventCard?.name ?? "missing card"}`);
      },
    });

    specialSummonDuelCard(session.state, firstSummon.uid);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["once-per-turn-special-trigger"]);

    activateTriggerByEffect(session, "once-per-turn-special-trigger");
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(session.state.usedCountKeys).toHaveLength(1);

    specialSummonDuelCard(session.state, secondSummon.uid);
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(session.state.usedCountKeys).toHaveLength(1);
    expect(session.state.log.filter((entry) => entry.detail.includes("Once trigger saw"))).toHaveLength(1);
  });

  it("allows once-per-turn triggers again on a later turn", () => {
    const { session, firstSummon, triggerSource, secondSummon } = setupTriggerCountFixture();

    registerEffect(session, {
      id: "turn-scoped-special-trigger",
      sourceUid: triggerSource.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      oncePerTurn: true,
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Turn-scoped trigger saw ${ctx.eventCard?.name ?? "missing card"}`);
      },
    });

    specialSummonDuelCard(session.state, firstSummon.uid);
    activateTriggerByEffect(session, "turn-scoped-special-trigger");
    expect(session.state.usedCountKeys).toHaveLength(1);

    session.state.turn += 1;
    session.state.waitingFor = 0;
    specialSummonDuelCard(session.state, secondSummon.uid);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["turn-scoped-special-trigger"]);
    activateTriggerByEffect(session, "turn-scoped-special-trigger");

    expect(session.state.usedCountKeys).toHaveLength(2);
    expect(new Set(session.state.usedCountKeys).size).toBe(2);
    expect(session.state.log.filter((entry) => entry.detail.includes("Turn-scoped trigger saw"))).toHaveLength(2);
  });

  it("keeps duel-scoped trigger count codes spent across later turns", () => {
    const { session, firstSummon, triggerSource, secondSummon } = setupTriggerCountFixture();

    registerEffect(session, {
      id: "duel-scoped-special-trigger",
      sourceUid: triggerSource.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      countLimit: 1,
      countLimitCode: 0x302,
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Duel-scoped trigger saw ${ctx.eventCard?.name ?? "missing card"}`);
      },
    });

    specialSummonDuelCard(session.state, firstSummon.uid);
    activateTriggerByEffect(session, "duel-scoped-special-trigger");
    expect(session.state.usedCountKeys).toEqual(["duel:0:code-770"]);

    session.state.turn += 1;
    session.state.waitingFor = 0;
    specialSummonDuelCard(session.state, secondSummon.uid);

    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(session.state.usedCountKeys).toEqual(["duel:0:code-770"]);
    expect(session.state.log.filter((entry) => entry.detail.includes("Duel-scoped trigger saw"))).toHaveLength(1);
  });

  it("shares trigger count codes across multiple trigger effects", () => {
    const { session, firstSummon, triggerSource, secondSummon } = setupTriggerCountFixture();

    registerEffect(session, {
      id: "first-shared-count-trigger",
      sourceUid: triggerSource.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      countLimit: 1,
      countLimitCode: 0x444,
      range: ["hand"],
      operation(ctx) {
        ctx.log(`First shared count saw ${ctx.eventCard?.name ?? "missing card"}`);
      },
    });
    registerEffect(session, {
      id: "second-shared-count-trigger",
      sourceUid: secondSummon.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      countLimit: 1,
      countLimitCode: 0x444,
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Second shared count saw ${ctx.eventCard?.name ?? "missing card"}`);
      },
    });

    specialSummonDuelCard(session.state, firstSummon.uid);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["first-shared-count-trigger", "second-shared-count-trigger"]);
    const firstTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "first-shared-count-trigger");
    const staleSecondTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "second-shared-count-trigger");
    expect(firstTrigger).toBeTruthy();
    expect(staleSecondTrigger).toBeTruthy();
    expect(applyResponse(session, firstTrigger!).ok).toBe(true);

    expect(session.state.usedCountKeys).toEqual(["turn-1:0:code-1092"]);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["second-shared-count-trigger"]);
    expect(getDuelLegalActions(session, 0).filter((action) => action.type === "activateTrigger")).toHaveLength(0);
    expect(applyResponse(session, staleSecondTrigger!).ok).toBe(false);
    const declineSecond = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger" && action.effectId === "second-shared-count-trigger");
    expect(declineSecond).toBeTruthy();
    expect(applyResponse(session, declineSecond!).ok).toBe(true);
    expect(session.state.log.some((entry) => entry.detail.includes("First shared count saw"))).toBe(true);
    expect(session.state.log.some((entry) => entry.detail.includes("Second shared count saw"))).toBe(false);
  });

  it("prunes mandatory shared-count triggers after a sibling spends the count", () => {
    const { session, firstSummon, triggerSource, secondSummon } = setupTriggerCountFixture();

    registerEffect(session, {
      id: "first-mandatory-shared-count-trigger",
      sourceUid: triggerSource.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      optional: false,
      countLimit: 1,
      countLimitCode: 0x555,
      range: ["hand"],
      operation(ctx) {
        ctx.log(`First mandatory shared count saw ${ctx.eventCard?.name ?? "missing card"}`);
      },
    });
    registerEffect(session, {
      id: "second-mandatory-shared-count-trigger",
      sourceUid: secondSummon.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      optional: false,
      countLimit: 1,
      countLimitCode: 0x555,
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Second mandatory shared count saw ${ctx.eventCard?.name ?? "missing card"}`);
      },
    });

    specialSummonDuelCard(session.state, firstSummon.uid);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["first-mandatory-shared-count-trigger", "second-mandatory-shared-count-trigger"]);

    activateTriggerByEffect(session, "first-mandatory-shared-count-trigger");

    expect(session.state.usedCountKeys).toEqual(["turn-1:0:code-1365"]);
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateTrigger" || action.type === "declineTrigger")).toBe(false);
    expect(session.state.waitingFor).toBe(0);
    expect(session.state.log.some((entry) => entry.detail.includes("First mandatory shared count saw"))).toBe(true);
    expect(session.state.log.some((entry) => entry.detail.includes("Second mandatory shared count saw"))).toBe(false);
  });

  it("collects phase and turn-start trigger effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const phaseSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const turnSource = queryPublicState(session).cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "400");
    expect(phaseSource).toBeTruthy();
    expect(turnSource).toBeTruthy();

    registerEffect(session, {
      id: "on-phase-change",
      sourceUid: phaseSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "phaseChanged",
      range: ["monsterZone"],
      operation(ctx) {
        ctx.log(`Observed ${ctx.eventName ?? "missing event"}`);
      },
    });
    registerEffect(session, {
      id: "on-turn-start",
      sourceUid: turnSource!.uid,
      controller: 1,
      event: "trigger",
      triggerEvent: "turnStarted",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Observed ${ctx.eventName ?? "missing event"}`);
      },
    });

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === phaseSource!.uid);
    expect(summon).toBeTruthy();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const battlePhase = getDuelLegalActions(session, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase).toBeTruthy();
    const phaseResult = applyResponse(session, battlePhase!);

    expect(phaseResult.ok).toBe(true);
    expect(phaseResult.state.pendingTriggers).toHaveLength(1);
    expect(phaseResult.state.pendingTriggers[0]).toMatchObject({ eventName: "phaseChanged", effectId: "on-phase-change" });
    expect(phaseResult.state.pendingTriggers[0]?.eventCardUid).toBeUndefined();
    const phaseTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "on-phase-change");
    expect(phaseTrigger).toBeTruthy();
    expect(applyResponse(session, phaseTrigger!).ok).toBe(true);

    const endTurn = getDuelLegalActions(session, 0).find((action) => action.type === "endTurn");
    expect(endTurn).toBeTruthy();
    const turnResult = applyResponse(session, endTurn!);

    expect(turnResult.ok).toBe(true);
    expect(turnResult.state.turn).toBe(2);
    expect(turnResult.state.pendingTriggers).toHaveLength(1);
    expect(turnResult.state.pendingTriggers[0]).toMatchObject({ player: 1, eventName: "turnStarted", effectId: "on-turn-start" });
  });

  it("collects trigger effects after a special summon operation", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "500");
    expect(source).toBeTruthy();
    expect(summoned).toBeTruthy();
    expect(triggerSource).toBeTruthy();

    registerEffect(session, {
      id: "summon-from-hand",
      sourceUid: source!.uid,
      controller: 0,
      event: "ignition",
      range: ["hand"],
      operation(ctx) {
        specialSummonDuelCard(ctx.duel, summoned!.uid, ctx.player);
      },
    });
    registerEffect(session, {
      id: "on-special-summon",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "specialSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Saw ${ctx.eventCard?.name ?? "missing card"} Special Summoned`);
      },
    });

    const activation = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "summon-from-hand");
    expect(activation).toBeTruthy();
    const activationResult = applyResponse(session, activation!);

    expect(activationResult.ok).toBe(true);
    expect(activationResult.state.cards.find((card) => card.uid === summoned!.uid)?.location).toBe("monsterZone");
    expect(activationResult.state.pendingTriggers).toHaveLength(1);
    expect(activationResult.state.pendingTriggers[0]).toMatchObject({ eventName: "specialSummoned", eventCardUid: summoned!.uid });
    const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === "on-special-summon");
    expect(trigger).toBeTruthy();
    const triggerResult = applyResponse(session, trigger!);

    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.state.log.some((entry) => entry.detail.includes("Second Monster Special Summoned"))).toBe(true);
  });
});
