import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions, loadDecks, restoreDuel, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";

describe("duel event state packets", () => {
  it("freezes event card previous and current state in history, pending triggers, and snapshots", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Moved Event Card", kind: "monster" },
      { code: "200", name: "Move Watcher", kind: "monster" },
      { code: "300", name: "Chain Keeper", kind: "monster" },
    ];
    const session = createDuel({ seed: 261, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300"] } });
    startDuel(session);

    const moved = session.state.cards.find((card) => card.code === "100");
    const watcher = session.state.cards.find((card) => card.code === "200");
    const reasonSource = session.state.cards.find((card) => card.code === "300");
    expect(moved).toBeDefined();
    expect(watcher).toBeDefined();
    expect(reasonSource).toBeDefined();
    const previousSequence = moved!.sequence;
    const previousPosition = moved!.position;
    moved!.reasonCardUid = reasonSource!.uid;
    moved!.reasonEffectId = 3001;

    session.state.effects.push({
      id: "watch-sent",
      sourceUid: watcher!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "sentToGraveyard",
      triggerTiming: "if",
      range: ["hand"],
      operation() {},
    });
    session.state.effects.push({
      id: "keep-chain-open",
      sourceUid: reasonSource!.uid,
      controller: 1,
      event: "quick",
      range: ["hand"],
      operation() {},
    });

    sendDuelCardToGraveyard(session.state, moved!.uid, 0, duelReason.effect, 1);

    const expectedPrevious = {
      controller: 0,
      location: "hand",
      sequence: previousSequence,
      position: previousPosition,
      faceUp: false,
    };
    const expectedCurrent = {
      controller: 0,
      location: "graveyard",
      sequence: 0,
      position: previousPosition,
      faceUp: true,
    };

    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventName: "sentToGraveyard",
          eventCardUid: moved!.uid,
          eventReason: duelReason.effect,
          eventReasonPlayer: 1,
          eventReasonCardUid: reasonSource!.uid,
          eventReasonEffectId: 3001,
          eventPreviousState: expectedPrevious,
          eventCurrentState: expectedCurrent,
        }),
      ]),
    );
    expect(session.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectId: "watch-sent",
          eventCardUid: moved!.uid,
          eventReason: duelReason.effect,
          eventReasonPlayer: 1,
          eventReasonCardUid: reasonSource!.uid,
          eventReasonEffectId: 3001,
          eventPreviousState: expectedPrevious,
          eventCurrentState: expectedCurrent,
          eventTriggerTiming: "if",
        }),
      ]),
    );

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), {}, {}, { pruneUnrestoredPendingTriggers: false });
    expect(restored.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventName: "sentToGraveyard",
          eventCardUid: moved!.uid,
          eventReason: duelReason.effect,
          eventReasonPlayer: 1,
          eventReasonCardUid: reasonSource!.uid,
          eventReasonEffectId: 3001,
          eventPreviousState: expectedPrevious,
          eventCurrentState: expectedCurrent,
        }),
      ]),
    );
    expect(restored.state.pendingTriggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectId: "watch-sent",
          eventCardUid: moved!.uid,
          eventReason: duelReason.effect,
          eventReasonPlayer: 1,
          eventReasonCardUid: reasonSource!.uid,
          eventReasonEffectId: 3001,
          eventPreviousState: expectedPrevious,
          eventCurrentState: expectedCurrent,
          eventTriggerTiming: "if",
        }),
      ]),
    );

    const triggerAction = getLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(triggerAction).toBeDefined();
    const result = applyResponse(session, triggerAction!);
    expect(result.ok, result.error).toBe(true);
    expect(session.state.chain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectId: "watch-sent",
          eventCardUid: moved!.uid,
          eventReason: duelReason.effect,
          eventReasonPlayer: 1,
          eventReasonCardUid: reasonSource!.uid,
          eventReasonEffectId: 3001,
          eventPreviousState: expectedPrevious,
          eventCurrentState: expectedCurrent,
          eventTriggerTiming: "if",
        }),
      ]),
    );
  });
});
