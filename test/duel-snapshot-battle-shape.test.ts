import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot battle restore shape validation", () => {
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
    const badKindStep = serializeDuel(session);
    badId.state.battleWindow = { id: "one" as unknown as number, kind: "attackDeclaration", step: "attack", attackerUid, targetUid, responsePlayer: 0, attackNegated: false };
    badKind.state.battleWindow = { id: 1, kind: "combat" as "attackDeclaration", step: "attack", attackerUid, responsePlayer: 0, attackNegated: false };
    badStep.state.battleWindow = { id: 1, kind: "attackDeclaration", step: "combat" as "attack", attackerUid, targetUid, responsePlayer: 0, attackNegated: false };
    badTarget.state.battleWindow = { id: 1, kind: "attackDeclaration", step: "attack", attackerUid, targetUid: "missing", responsePlayer: 0, attackNegated: false };
    badAttackNegated.state.battleWindow = { id: 1, kind: "attackDeclaration", step: "attack", attackerUid, targetUid, responsePlayer: 0, attackNegated: "no" as unknown as boolean };
    badResponsePlayer.state.battleWindow = { id: 1, kind: "attackDeclaration", step: "attack", attackerUid, responsePlayer: 2 as 0, attackNegated: false };
    badKindStep.state.battleWindow = { id: 1, kind: "duringDamageCalculation", step: "damage", attackerUid, responsePlayer: 0, attackNegated: false };

    expect(() => restoreDuel(badId, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.id must be a number");
    expect(() => restoreDuel(badKind, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.kind must be a battle window kind");
    expect(() => restoreDuel(badStep, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.step must be a battle step");
    expect(() => restoreDuel(badTarget, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.targetUid must reference a card");
    expect(() => restoreDuel(badAttackNegated, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.attackNegated must be a boolean");
    expect(() => restoreDuel(badResponsePlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.responsePlayer must be a player id");
    expect(() => restoreDuel(badKindStep, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.kind must match step");
  });

  it("rejects battle windows without matching battle context before restore", () => {
    const session = createDuel({ seed: 175, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const orphanedWindow = serializeDuel(session);
    const mismatchedStep = serializeDuel(session);
    const mismatchedWaitingFor = serializeDuel(session);
    orphanedWindow.state.battleWindow = { id: 1, kind: "attackNegationResponse", step: "attack", attackerUid, responsePlayer: 1, attackNegated: false };
    mismatchedStep.state.pendingBattle = { attackerUid };
    mismatchedStep.state.battleStep = "damage";
    mismatchedStep.state.battleWindow = { id: 1, kind: "attackNegationResponse", step: "attack", attackerUid, responsePlayer: 1, attackNegated: false };
    mismatchedWaitingFor.state.pendingBattle = { attackerUid };
    mismatchedWaitingFor.state.waitingFor = 0;
    mismatchedWaitingFor.state.battleWindow = { id: 1, kind: "attackNegationResponse", step: "attack", attackerUid, responsePlayer: 1, attackNegated: false };

    expect(() => restoreDuel(orphanedWindow, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow requires battle state");
    expect(() => restoreDuel(mismatchedStep, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleStep must match battleWindow.step");
    expect(() => restoreDuel(mismatchedWaitingFor, createCardReader(cards))).toThrow("Malformed duel snapshot: state.waitingFor must match battleWindow.responsePlayer");
  });

  it("rejects battle windows that do not match their battle state before restore", () => {
    const session = createDuel({ seed: 181, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const targetUid = serializeDuel(session).state.cards[1]!.uid;
    const mismatchedAttacker = serializeDuel(session);
    const mismatchedTarget = serializeDuel(session);
    mismatchedAttacker.state.pendingBattle = { attackerUid };
    mismatchedAttacker.state.battleWindow = { id: 1, kind: "attackNegationResponse", step: "attack", attackerUid: targetUid, responsePlayer: 1, attackNegated: false };
    mismatchedAttacker.state.waitingFor = 1;
    mismatchedTarget.state.pendingBattle = { attackerUid, targetUid };
    mismatchedTarget.state.battleWindow = { id: 1, kind: "attackTargetConfirmation", step: "attack", attackerUid, responsePlayer: 0, attackNegated: false };
    mismatchedTarget.state.waitingFor = 0;

    expect(() => restoreDuel(mismatchedAttacker, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.attackerUid must match battle state");
    expect(() => restoreDuel(mismatchedTarget, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.targetUid must match battle state");
  });

  it("rejects replay decision windows that do not match the attacker before restore", () => {
    const session = createDuel({ seed: 182, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const wrongPlayer = serializeDuel(session);
    const wrongLocation = serializeDuel(session);
    wrongPlayer.state.pendingBattle = { attackerUid };
    wrongPlayer.state.waitingFor = 1;
    wrongPlayer.state.cards[0] = { ...wrongPlayer.state.cards[0]!, location: "monsterZone" };
    wrongPlayer.state.battleWindow = { id: 1, kind: "replayDecision", step: "attack", attackerUid, responsePlayer: 1, attackNegated: false };
    wrongLocation.state.pendingBattle = { attackerUid };
    wrongLocation.state.waitingFor = 0;
    wrongLocation.state.cards[0] = { ...wrongLocation.state.cards[0]!, location: "graveyard" };
    wrongLocation.state.battleWindow = { id: 1, kind: "replayDecision", step: "attack", attackerUid, responsePlayer: 0, attackNegated: false };

    expect(() => restoreDuel(wrongPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.responsePlayer must match replay attacker controller");
    expect(() => restoreDuel(wrongLocation, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.attackerUid must reference a monster-zone card for replay decision");
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
