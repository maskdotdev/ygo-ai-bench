import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot pending-window numeric validation", () => {
  it("rejects empty action window tokens before restore", () => {
    const session = createDuel({ seed: 235, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    snapshot.state.actionWindowToken = "";

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.actionWindowToken must be a non-empty string");
  });

  it("rejects impossible chain limit expiry snapshots before restore", () => {
    const session = createDuel({ seed: 236, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    negative.state.chainLimits = [{ registryKey: "limit", expiresAtChainLength: -1, untilChainEnd: false }];
    fractional.state.chainLimits = [{ registryKey: "limit", expiresAtChainLength: 0.5, untilChainEnd: false }];

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainLimits.0.expiresAtChainLength must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.chainLimits.0.expiresAtChainLength must be a non-negative integer");
  });

  it("rejects impossible battle replay count snapshots before restore", () => {
    const session = createDuel({ seed: 237, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const targetUid = serializeDuel(session).state.cards[1]!.uid;
    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    negative.state.currentAttack = { attackerUid, targetUid, replayTargetCount: -1, replayTargetUids: [targetUid] };
    fractional.state.pendingBattle = { attackerUid, targetUid, replayTargetCount: 0.5, replayTargetUids: [targetUid] };

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.replayTargetCount must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.replayTargetCount must be a non-negative integer");
  });

  it("rejects impossible battle damage override snapshots before restore", () => {
    const session = createDuel({ seed: 238, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const targetUid = serializeDuel(session).state.cards[1]!.uid;
    const negative = serializeDuel(session);
    const fractional = serializeDuel(session);
    negative.state.pendingBattle = { attackerUid, targetUid, battleDamageOverrides: { 0: -1 } };
    fractional.state.pendingBattle = { attackerUid, targetUid, battleDamageOverrides: { 1: 0.5 } };

    expect(() => restoreDuel(negative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.battleDamageOverrides.0 must be a non-negative integer");
    expect(() => restoreDuel(fractional, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.battleDamageOverrides.1 must be a non-negative integer");
  });
});
