import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel aggregate snapshot shape validation", () => {
  it("rejects unknown aggregate counter and damage fields before restore", () => {
    const session = createDuel({ seed: 612, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["400"] } });
    startDuel(session);
    const staleActivityPlayer = serializeDuel(session);
    const staleActivityCount = serializeDuel(session);
    const staleBattleDamage = serializeDuel(session);

    staleActivityPlayer.state.activityCounts = { ...staleActivityPlayer.state.activityCounts, 2: staleActivityPlayer.state.activityCounts[0] } as typeof staleActivityPlayer.state.activityCounts;
    staleActivityCount.state.activityCounts[0] = { ...staleActivityCount.state.activityCounts[0], staleActivity: 1 } as typeof staleActivityCount.state.activityCounts[0];
    staleBattleDamage.state.battleDamage = { ...staleBattleDamage.state.battleDamage, 2: 100 } as typeof staleBattleDamage.state.battleDamage;

    expect(() => restoreDuel(staleActivityPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityCounts must use player ids");
    expect(() => restoreDuel(staleActivityCount, createCardReader(cards))).toThrow("Malformed duel snapshot: state.activityCounts.0.staleActivity is not a known field");
    expect(() => restoreDuel(staleBattleDamage, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleDamage must use player ids");
  });

  it("rejects unknown player and option fields before restore", () => {
    const session = createDuel({ seed: 613, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["400"] } });
    startDuel(session);
    const stalePlayerId = serializeDuel(session);
    const stalePlayerField = serializeDuel(session);
    const staleOptionsField = serializeDuel(session);

    stalePlayerId.state.players = { ...stalePlayerId.state.players, 2: stalePlayerId.state.players[0] } as typeof stalePlayerId.state.players;
    stalePlayerField.state.players[0] = { ...stalePlayerField.state.players[0], stalePlayer: true } as typeof stalePlayerField.state.players[0];
    staleOptionsField.state.options = { ...staleOptionsField.state.options, staleOption: 1 } as typeof staleOptionsField.state.options;

    expect(() => restoreDuel(stalePlayerId, createCardReader(cards))).toThrow("Malformed duel snapshot: state.players must use player ids");
    expect(() => restoreDuel(stalePlayerField, createCardReader(cards))).toThrow("Malformed duel snapshot: state.players.0.stalePlayer is not a known field");
    expect(() => restoreDuel(staleOptionsField, createCardReader(cards))).toThrow("Malformed duel snapshot: state.options.staleOption is not a known field");
  });

  it("rejects malformed extra Pendulum summon grants before restore", () => {
    const session = createDuel({ seed: 614, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["400"] } });
    startDuel(session);
    const staleGrant = serializeDuel(session);
    const badScalePlayer = serializeDuel(session);
    const staleAlternative = serializeDuel(session);

    staleGrant.state.players[0] = { ...staleGrant.state.players[0], extraPendulumSummonGrants: [{ staleGrant: true }] } as unknown as typeof staleGrant.state.players[0];
    badScalePlayer.state.players[0] = { ...badScalePlayer.state.players[0], extraPendulumSummonGrants: [{ scalePlayer: 2 }] } as unknown as typeof badScalePlayer.state.players[0];
    staleAlternative.state.players[0] = { ...staleAlternative.state.players[0], extraPendulumSummonGrants: [{ scaleAlternatives: [{ scalePlayer: 1, staleAlternative: true }] }] } as unknown as typeof staleAlternative.state.players[0];

    expect(() => restoreDuel(staleGrant, createCardReader(cards))).toThrow("Malformed duel snapshot: state.players.0.extraPendulumSummonGrants.0.staleGrant is not a known field");
    expect(() => restoreDuel(badScalePlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.players.0.extraPendulumSummonGrants.0.scalePlayer must be a player id");
    expect(() => restoreDuel(staleAlternative, createCardReader(cards))).toThrow("Malformed duel snapshot: state.players.0.extraPendulumSummonGrants.0.scaleAlternatives.0.staleAlternative is not a known field");
  });

  it("rejects impossible extra Pendulum summon grant numbers before restore", () => {
    const session = createDuel({ seed: 615, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["400"] } });
    startDuel(session);
    const badLocationMask = serializeDuel(session);
    const badSetcode = serializeDuel(session);
    const badAlternativeMask = serializeDuel(session);

    badLocationMask.state.players[0] = { ...badLocationMask.state.players[0], extraPendulumSummonGrants: [{ locationMask: -1 }] } as unknown as typeof badLocationMask.state.players[0];
    badSetcode.state.players[0] = { ...badSetcode.state.players[0], extraPendulumSummonGrants: [{ setcode: 1.5 }] } as unknown as typeof badSetcode.state.players[0];
    badAlternativeMask.state.players[0] = { ...badAlternativeMask.state.players[0], extraPendulumSummonGrants: [{ scaleAlternatives: [{ scalePlayer: 1, locationMask: 0.5 }] }] } as unknown as typeof badAlternativeMask.state.players[0];

    expect(() => restoreDuel(badLocationMask, createCardReader(cards))).toThrow("Malformed duel snapshot: state.players.0.extraPendulumSummonGrants.0.locationMask must be a non-negative integer");
    expect(() => restoreDuel(badSetcode, createCardReader(cards))).toThrow("Malformed duel snapshot: state.players.0.extraPendulumSummonGrants.0.setcode must be a non-negative integer");
    expect(() => restoreDuel(badAlternativeMask, createCardReader(cards))).toThrow("Malformed duel snapshot: state.players.0.extraPendulumSummonGrants.0.scaleAlternatives.0.locationMask must be a non-negative integer");
  });
});
