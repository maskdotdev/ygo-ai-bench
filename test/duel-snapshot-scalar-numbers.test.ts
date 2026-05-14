import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot scalar numeric validation", () => {
  it("rejects impossible engine counter snapshots before restore", () => {
    const session = createDuel({ seed: 244, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const negativeWindow = serializeDuel(session);
    const unsafeWindow = serializeDuel(session);
    const fractionalTurn = serializeDuel(session);
    const unsafeTurn = serializeDuel(session);
    const fractionalRandom = serializeDuel(session);
    const infiniteDuelTypeFlags = serializeDuel(session);
    const nanGlobalFlags = serializeDuel(session);
    const fractionalAttackCostPaid = serializeDuel(session);
    const infiniteWinReason = serializeDuel(session);
    negativeWindow.state.actionWindowId = -1;
    unsafeWindow.state.actionWindowId = Number.MAX_SAFE_INTEGER + 1;
    fractionalTurn.state.turn = 1.5;
    unsafeTurn.state.turn = Number.MAX_SAFE_INTEGER + 1;
    fractionalRandom.state.randomCounter = 0.5;
    infiniteDuelTypeFlags.state.duelTypeFlags = Number.POSITIVE_INFINITY;
    nanGlobalFlags.state.globalFlags = Number.NaN;
    fractionalAttackCostPaid.state.attackCostPaid = 0.5;
    infiniteWinReason.state.winReason = Number.POSITIVE_INFINITY;

    expect(() => restoreDuel(negativeWindow, createCardReader(cards))).toThrow("Malformed duel snapshot: state.actionWindowId must be a non-negative integer");
    expect(() => restoreDuel(unsafeWindow, createCardReader(cards))).toThrow("Malformed duel snapshot: state.actionWindowId must be a safe integer");
    expect(() => restoreDuel(fractionalTurn, createCardReader(cards))).toThrow("Malformed duel snapshot: state.turn must be a non-negative integer");
    expect(() => restoreDuel(unsafeTurn, createCardReader(cards))).toThrow("Malformed duel snapshot: state.turn must be a safe integer");
    expect(() => restoreDuel(fractionalRandom, createCardReader(cards))).toThrow("Malformed duel snapshot: state.randomCounter must be a non-negative integer");
    expect(() => restoreDuel(infiniteDuelTypeFlags, createCardReader(cards))).toThrow("Malformed duel snapshot: state.duelTypeFlags must be a non-negative integer");
    expect(() => restoreDuel(nanGlobalFlags, createCardReader(cards))).toThrow("Malformed duel snapshot: state.globalFlags must be a non-negative integer");
    expect(() => restoreDuel(fractionalAttackCostPaid, createCardReader(cards))).toThrow("Malformed duel snapshot: state.attackCostPaid must be a non-negative integer");
    expect(() => restoreDuel(infiniteWinReason, createCardReader(cards))).toThrow("Malformed duel snapshot: state.winReason must be a non-negative integer");
  });

  it("rejects non-finite nested numeric snapshots before restore", () => {
    const session = createDuel({ seed: 245, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const badEventValue = serializeDuel(session);
    const badEventReasonEffect = serializeDuel(session);
    const badRelatedEffect = serializeDuel(session);
    const badCardReason = serializeDuel(session);
    const badCardDataAttack = serializeDuel(session);
    const badPreviousSetcode = serializeDuel(session);
    const badActivity = serializeDuel(session);
    badEventValue.state.eventHistory.push({ eventName: "customEvent", eventValue: Number.POSITIVE_INFINITY });
    badEventReasonEffect.state.eventHistory.push({ eventName: "customEvent", eventReasonEffectId: 1.5 });
    badRelatedEffect.state.eventHistory.push({ eventName: "customEvent", relatedEffectId: -1 });
    badCardReason.state.cards[0] = { ...badCardReason.state.cards[0]!, reason: Number.NaN };
    badCardDataAttack.state.cards[0] = { ...badCardDataAttack.state.cards[0]!, data: { ...badCardDataAttack.state.cards[0]!.data, attack: Number.NEGATIVE_INFINITY } };
    badPreviousSetcode.state.cards[0] = { ...badPreviousSetcode.state.cards[0]!, previousSetcodes: [Number.NaN] };
    badActivity.state.activityHistory.push({ player: 0, activity: Number.POSITIVE_INFINITY });

    expect(() => restoreDuel(badEventValue, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventValue must be a finite number");
    expect(() => restoreDuel(badEventReasonEffect, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.eventReasonEffectId must be a non-negative integer");
    expect(() => restoreDuel(badRelatedEffect, createCardReader(cards))).toThrow("Malformed duel snapshot: state.eventHistory.0.relatedEffectId must be a non-negative integer");
    expect(() => restoreDuel(badCardReason, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.reason must be a finite number");
    expect(() => restoreDuel(badCardDataAttack, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.data.attack must be a finite number");
    expect(() => restoreDuel(badPreviousSetcode, createCardReader(cards))).toThrow("Malformed duel snapshot: state.cards.0.previousSetcodes.0 must be a finite number");
    expect(() => restoreDuel(badActivity, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityHistory.0.activity must be a finite number");
  });
});
