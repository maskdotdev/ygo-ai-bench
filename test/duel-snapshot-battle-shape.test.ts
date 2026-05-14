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

  it("rejects unknown battle window snapshot fields before restore", () => {
    const session = createDuel({ seed: 242, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const snapshot = serializeDuel(session);
    snapshot.state.battleWindow = { id: 1, kind: "attackDeclaration", step: "attack", attackerUid, responsePlayer: 0, attackNegated: false, staleWindow: true } as unknown as NonNullable<typeof snapshot.state.battleWindow>;

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.staleWindow is not a known field");
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
    putInBattlePhase(mismatchedStep, mismatchedWaitingFor);
    declareSnapshotAttack(attackerUid, mismatchedStep, mismatchedWaitingFor);
    mismatchedStep.state.currentAttack = { attackerUid };
    mismatchedStep.state.pendingBattle = { attackerUid };
    mismatchedStep.state.battleStep = "damage";
    mismatchedStep.state.battleWindow = { id: 1, kind: "attackNegationResponse", step: "attack", attackerUid, responsePlayer: 1, attackNegated: false };
    mismatchedWaitingFor.state.currentAttack = { attackerUid };
    mismatchedWaitingFor.state.pendingBattle = { attackerUid };
    mismatchedWaitingFor.state.battleStep = "attack";
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
    putInBattlePhase(mismatchedAttacker, mismatchedTarget);
    declareSnapshotAttack(attackerUid, mismatchedAttacker, mismatchedTarget);
    mismatchedAttacker.state.currentAttack = { attackerUid };
    mismatchedAttacker.state.pendingBattle = { attackerUid };
    mismatchedAttacker.state.battleStep = "attack";
    mismatchedAttacker.state.battleWindow = { id: 1, kind: "attackNegationResponse", step: "attack", attackerUid: targetUid, responsePlayer: 1, attackNegated: false };
    mismatchedAttacker.state.waitingFor = 1;
    mismatchedTarget.state.currentAttack = { attackerUid, targetUid };
    mismatchedTarget.state.pendingBattle = { attackerUid, targetUid };
    mismatchedTarget.state.battleStep = "attack";
    mismatchedTarget.state.battleWindow = { id: 1, kind: "attackTargetConfirmation", step: "attack", attackerUid, responsePlayer: 0, attackNegated: false };
    mismatchedTarget.state.waitingFor = 0;

    expect(() => restoreDuel(mismatchedAttacker, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.attackerUid must match battle state");
    expect(() => restoreDuel(mismatchedTarget, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.targetUid must match battle state");
  });

  it("rejects negated battle windows before restore", () => {
    const session = createDuel({ seed: 184, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const negatedWindow = serializeDuel(session);
    putInBattlePhase(negatedWindow);
    declareSnapshotAttack(attackerUid, negatedWindow);
    negatedWindow.state.currentAttack = { attackerUid };
    negatedWindow.state.pendingBattle = { attackerUid };
    negatedWindow.state.battleStep = "attack";
    negatedWindow.state.waitingFor = 1;
    negatedWindow.state.battleWindow = { id: 1, kind: "attackNegationResponse", step: "attack", attackerUid, responsePlayer: 1, attackNegated: true };

    expect(() => restoreDuel(negatedWindow, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.attackNegated cannot be pending");
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
    putInBattlePhase(wrongPlayer, wrongLocation);
    declareSnapshotAttack(attackerUid, wrongPlayer, wrongLocation);
    wrongPlayer.state.currentAttack = { attackerUid };
    wrongPlayer.state.pendingBattle = { attackerUid };
    wrongPlayer.state.battleStep = "attack";
    wrongPlayer.state.waitingFor = 1;
    wrongPlayer.state.cards[0] = { ...wrongPlayer.state.cards[0]!, location: "monsterZone" };
    wrongPlayer.state.battleWindow = { id: 1, kind: "replayDecision", step: "attack", attackerUid, responsePlayer: 1, attackNegated: false };
    wrongLocation.state.currentAttack = { attackerUid };
    wrongLocation.state.pendingBattle = { attackerUid };
    wrongLocation.state.battleStep = "attack";
    wrongLocation.state.waitingFor = 0;
    wrongLocation.state.cards[0] = { ...wrongLocation.state.cards[0]!, location: "graveyard" };
    wrongLocation.state.battleWindow = { id: 1, kind: "replayDecision", step: "attack", attackerUid, responsePlayer: 0, attackNegated: false };

    expect(() => restoreDuel(wrongPlayer, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.responsePlayer must match replay attacker controller");
    expect(() => restoreDuel(wrongLocation, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.attackerUid must reference a monster-zone card for replay decision");
  });

  it("rejects battle pass snapshots outside their battle step before restore", () => {
    const session = createDuel({ seed: 174, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const badAttackStep = serializeDuel(session);
    const badDamageStep = serializeDuel(session);
    putInBattlePhase(badAttackStep, badDamageStep);
    declareSnapshotAttack(attackerUid, badAttackStep, badDamageStep);
    badAttackStep.state.currentAttack = { attackerUid };
    badAttackStep.state.pendingBattle = { attackerUid };
    badAttackStep.state.battleStep = "damage";
    badAttackStep.state.attackPasses = [1];
    badDamageStep.state.currentAttack = { attackerUid };
    badDamageStep.state.pendingBattle = { attackerUid };
    badDamageStep.state.battleStep = "attack";
    badDamageStep.state.damagePasses = [0];

    expect(() => restoreDuel(badAttackStep, createCardReader(cards))).toThrow("Malformed duel snapshot: state.attackPasses requires an attack battle step");
    expect(() => restoreDuel(badDamageStep, createCardReader(cards))).toThrow("Malformed duel snapshot: state.damagePasses requires a damage battle step");
  });

  it("rejects active battle response players already marked as passed before restore", () => {
    const session = createDuel({ seed: 179, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const badAttackPass = serializeDuel(session);
    const badDamagePass = serializeDuel(session);
    putInBattlePhase(badAttackPass, badDamagePass);
    declareSnapshotAttack(attackerUid, badAttackPass, badDamagePass);
    badAttackPass.state.currentAttack = { attackerUid };
    badAttackPass.state.pendingBattle = { attackerUid };
    badAttackPass.state.battleStep = "attack";
    badAttackPass.state.battleWindow = { id: 1, kind: "attackNegationResponse", step: "attack", attackerUid, responsePlayer: 1, attackNegated: false };
    badAttackPass.state.waitingFor = 1;
    badAttackPass.state.attackPasses = [1];
    badDamagePass.state.currentAttack = { attackerUid };
    badDamagePass.state.pendingBattle = { attackerUid };
    badDamagePass.state.battleStep = "damage";
    badDamagePass.state.battleWindow = { id: 1, kind: "startDamageStep", step: "damage", attackerUid, responsePlayer: 0, attackNegated: false };
    badDamagePass.state.waitingFor = 0;
    badDamagePass.state.damagePasses = [0];

    expect(() => restoreDuel(badAttackPass, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.responsePlayer must not be included in attackPasses");
    expect(() => restoreDuel(badDamagePass, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.responsePlayer must not be included in damagePasses");
  });

  it("rejects completed battle pass snapshots before restore", () => {
    const session = createDuel({ seed: 180, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const badAttackPasses = serializeDuel(session);
    const badDamagePasses = serializeDuel(session);
    putInBattlePhase(badAttackPasses, badDamagePasses);
    declareSnapshotAttack(attackerUid, badAttackPasses, badDamagePasses);
    badAttackPasses.state.currentAttack = { attackerUid };
    badAttackPasses.state.pendingBattle = { attackerUid };
    badAttackPasses.state.battleStep = "attack";
    badAttackPasses.state.attackPasses = [0, 1];
    badDamagePasses.state.currentAttack = { attackerUid };
    badDamagePasses.state.pendingBattle = { attackerUid };
    badDamagePasses.state.battleStep = "damage";
    badDamagePasses.state.damagePasses = [0, 1];

    expect(() => restoreDuel(badAttackPasses, createCardReader(cards))).toThrow("Malformed duel snapshot: state.attackPasses must not contain both players");
    expect(() => restoreDuel(badDamagePasses, createCardReader(cards))).toThrow("Malformed duel snapshot: state.damagePasses must not contain both players");
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
    const unsafeCurrentAttack = serializeDuel(session);
    const badReplayTargets = serializeDuel(session);
    const badPendingReplayTargets = serializeDuel(session);
    const duplicateReplayTargets = serializeDuel(session);
    const badPendingBattle = serializeDuel(session);
    const badDamageOverrides = serializeDuel(session);
    const badDamageAmount = serializeDuel(session);
    putInBattlePhase(badPendingReplayTargets, duplicateReplayTargets, badPendingBattle, badDamageOverrides, badDamageAmount);
    declareSnapshotAttack(attackerUid, badPendingReplayTargets, duplicateReplayTargets, badPendingBattle, badDamageOverrides, badDamageAmount);
    badAttacker.state.currentAttack = { attackerUid: "missing" };
    badTarget.state.currentAttack = { attackerUid, targetUid: 7 as unknown as string };
    badCurrentAttack.state.currentAttack = { attackerUid, replayTargetCount: "two" as unknown as number };
    unsafeCurrentAttack.state.currentAttack = { attackerUid, replayTargetCount: Number.MAX_SAFE_INTEGER + 1 };
    badReplayTargets.state.currentAttack = { attackerUid, replayTargetUids: [targetUid, "missing"] };
    badPendingReplayTargets.state.currentAttack = { attackerUid, replayTargetUids: [targetUid] };
    badPendingReplayTargets.state.pendingBattle = { attackerUid, replayTargetUids: [targetUid, "missing"] };
    duplicateReplayTargets.state.currentAttack = { attackerUid, replayTargetUids: [targetUid, targetUid] };
    duplicateReplayTargets.state.pendingBattle = { attackerUid, replayTargetUids: [targetUid, targetUid] };
    badPendingBattle.state.currentAttack = { attackerUid };
    badPendingBattle.state.pendingBattle = { attackerUid, battleDamageOverrides: { 2: 100 } as unknown as Record<0 | 1, number> };
    badDamageOverrides.state.currentAttack = { attackerUid };
    badDamageOverrides.state.pendingBattle = { attackerUid, battleDamageOverrides: "100" as unknown as Record<0 | 1, number> };
    badDamageAmount.state.currentAttack = { attackerUid };
    badDamageAmount.state.pendingBattle = { attackerUid, battleDamageOverrides: { 0: "100" as unknown as number } };

    expect(() => restoreDuel(badAttacker, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.attackerUid must reference a card");
    expect(() => restoreDuel(badTarget, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.targetUid must be a string");
    expect(() => restoreDuel(badCurrentAttack, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.replayTargetCount must be a number");
    expect(() => restoreDuel(unsafeCurrentAttack, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.replayTargetCount must be a safe integer");
    expect(() => restoreDuel(badReplayTargets, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.replayTargetUids.1 must reference a card");
    expect(() => restoreDuel(badPendingReplayTargets, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.replayTargetUids.1 must reference a card");
    expect(() => restoreDuel(duplicateReplayTargets, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.replayTargetUids must not contain duplicates");
    expect(() => restoreDuel(badPendingBattle, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.battleDamageOverrides must use player ids");
    expect(() => restoreDuel(badDamageOverrides, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.battleDamageOverrides must be an object");
    expect(() => restoreDuel(badDamageAmount, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.battleDamageOverrides.0 must be a number");
  });

  it("rejects unknown battle-state snapshot fields before restore", () => {
    const session = createDuel({ seed: 243, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const reasonCardUid = serializeDuel(session).state.cards[1]!.uid;
    const badCurrent = serializeDuel(session);
    const badPending = serializeDuel(session);
    const badDeferred = serializeDuel(session);
    putInBattlePhase(badCurrent, badPending, badDeferred);
    declareSnapshotAttack(attackerUid, badCurrent, badPending, badDeferred);
    badCurrent.state.currentAttack = { attackerUid, staleAttack: true } as unknown as NonNullable<typeof badCurrent.state.currentAttack>;
    badCurrent.state.pendingBattle = { attackerUid };
    badPending.state.currentAttack = { attackerUid };
    badPending.state.pendingBattle = { attackerUid, stalePending: true } as unknown as NonNullable<typeof badPending.state.pendingBattle>;
    badDeferred.state.currentAttack = { attackerUid };
    badDeferred.state.pendingBattle = { attackerUid, deferredBattleDestroyed: [{ uid: attackerUid, reasonPlayer: 0, reasonCardUid, staleDestroyed: true }] } as unknown as NonNullable<typeof badDeferred.state.pendingBattle>;

    expect(() => restoreDuel(badCurrent, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.staleAttack is not a known field");
    expect(() => restoreDuel(badPending, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.stalePending is not a known field");
    expect(() => restoreDuel(badDeferred, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.deferredBattleDestroyed.0.staleDestroyed is not a known field");
  });

  it("rejects half-present battle state before restore", () => {
    const session = createDuel({ seed: 185, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const missingCurrentAttack = serializeDuel(session);
    const missingPendingBattle = serializeDuel(session);
    putInBattlePhase(missingCurrentAttack, missingPendingBattle);
    declareSnapshotAttack(attackerUid, missingCurrentAttack, missingPendingBattle);
    missingCurrentAttack.state.pendingBattle = { attackerUid };
    missingPendingBattle.state.currentAttack = { attackerUid };

    expect(() => restoreDuel(missingCurrentAttack, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack is required with pendingBattle");
    expect(() => restoreDuel(missingPendingBattle, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle is required with currentAttack");
  });

  it("rejects battle state without a battle step before restore", () => {
    const session = createDuel({ seed: 193, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const snapshot = serializeDuel(session);
    putInBattlePhase(snapshot);
    declareSnapshotAttack(attackerUid, snapshot);
    snapshot.state.currentAttack = { attackerUid };
    snapshot.state.pendingBattle = { attackerUid };

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: battle state requires battleStep");
  });

  it("rejects current attack damage override snapshots before restore", () => {
    const session = createDuel({ seed: 189, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const snapshot = serializeDuel(session);
    putInBattlePhase(snapshot);
    declareSnapshotAttack(attackerUid, snapshot);
    snapshot.state.currentAttack = { attackerUid, battleDamageOverrides: { 1: 100 } } as NonNullable<typeof snapshot.state.currentAttack>;
    snapshot.state.pendingBattle = { attackerUid };

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack must not contain battleDamageOverrides");
  });

  it("rejects undeclared active attack snapshots before restore", () => {
    const session = createDuel({ seed: 192, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const snapshot = serializeDuel(session);
    putInBattlePhase(snapshot);
    snapshot.state.currentAttack = { attackerUid };
    snapshot.state.pendingBattle = { attackerUid };

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.attackerUid must be declared as an attack");
  });

  it("rejects battle state outside the battle phase before restore", () => {
    const session = createDuel({ seed: 186, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const snapshot = serializeDuel(session);
    snapshot.state.phase = "main1";
    declareSnapshotAttack(attackerUid, snapshot);
    snapshot.state.currentAttack = { attackerUid };
    snapshot.state.pendingBattle = { attackerUid };

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: battle state requires the battle phase");
  });

  it("rejects battle state outside active duels before restore", () => {
    const session = createDuel({ seed: 191, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const snapshot = serializeDuel(session);
    putInBattlePhase(snapshot);
    declareSnapshotAttack(attackerUid, snapshot);
    snapshot.state.status = "ended";
    snapshot.state.winner = 1;
    delete snapshot.state.waitingFor;
    snapshot.state.currentAttack = { attackerUid };
    snapshot.state.pendingBattle = { attackerUid };

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: battle state requires an active duel");
  });

  it("rejects battle steps without battle state before restore", () => {
    const session = createDuel({ seed: 187, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const snapshot = serializeDuel(session);
    snapshot.state.battleStep = "damage";

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleStep requires battle state");
  });

  it("rejects battle windows without mirrored battle step before restore", () => {
    const session = createDuel({ seed: 188, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const snapshot = serializeDuel(session);
    putInBattlePhase(snapshot);
    declareSnapshotAttack(attackerUid, snapshot);
    snapshot.state.currentAttack = { attackerUid };
    snapshot.state.pendingBattle = { attackerUid };
    snapshot.state.battleWindow = { id: 1, kind: "attackNegationResponse", step: "attack", attackerUid, responsePlayer: 1, attackNegated: false };

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleStep is required with battleWindow");
  });

  it("rejects battle windows with mismatched action window ids before restore", () => {
    const session = createDuel({ seed: 190, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const snapshot = serializeDuel(session);
    putInBattlePhase(snapshot);
    declareSnapshotAttack(attackerUid, snapshot);
    snapshot.state.currentAttack = { attackerUid };
    snapshot.state.pendingBattle = { attackerUid };
    snapshot.state.battleStep = "attack";
    snapshot.state.actionWindowId = 1;
    snapshot.state.battleWindow = { id: snapshot.state.actionWindowId + 1, kind: "attackNegationResponse", step: "attack", attackerUid, responsePlayer: 1, attackNegated: false };

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.battleWindow.id must not exceed actionWindowId");
  });

  it("rejects active battle windows outside awaiting status before restore", () => {
    const session = createDuel({ seed: 192, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const snapshot = serializeDuel(session);
    putInBattlePhase(snapshot);
    declareSnapshotAttack(attackerUid, snapshot);
    snapshot.state.status = "resolving";
    snapshot.state.currentAttack = { attackerUid };
    snapshot.state.pendingBattle = { attackerUid };
    snapshot.state.battleStep = "attack";
    snapshot.state.waitingFor = 1;
    snapshot.state.battleWindow = { id: 1, kind: "attackNegationResponse", step: "attack", attackerUid, responsePlayer: 1, attackNegated: false };

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: active battleWindow requires an awaiting duel");
  });

  it("rejects pending battle snapshots that diverge from current attack before restore", () => {
    const session = createDuel({ seed: 183, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const targetUid = serializeDuel(session).state.cards[1]!.uid;
    const mismatchedAttacker = serializeDuel(session);
    const mismatchedTarget = serializeDuel(session);
    const mismatchedReplayCount = serializeDuel(session);
    const mismatchedReplayTargets = serializeDuel(session);
    const mismatchedCurrentReplayShape = serializeDuel(session);
    const mismatchedPendingReplayShape = serializeDuel(session);
    const missingCurrentReplayTargets = serializeDuel(session);
    const missingPendingReplayCount = serializeDuel(session);
    putInBattlePhase(mismatchedAttacker, mismatchedTarget, mismatchedReplayCount, mismatchedReplayTargets, mismatchedCurrentReplayShape, mismatchedPendingReplayShape, missingCurrentReplayTargets, missingPendingReplayCount);
    declareSnapshotAttack(attackerUid, mismatchedAttacker, mismatchedTarget, mismatchedReplayCount, mismatchedReplayTargets, mismatchedCurrentReplayShape, mismatchedPendingReplayShape, missingCurrentReplayTargets, missingPendingReplayCount);
    mismatchedAttacker.state.currentAttack = { attackerUid };
    mismatchedAttacker.state.pendingBattle = { attackerUid: targetUid };
    mismatchedTarget.state.currentAttack = { attackerUid, targetUid };
    mismatchedTarget.state.pendingBattle = { attackerUid };
    mismatchedReplayCount.state.currentAttack = { attackerUid, replayTargetCount: 1, replayTargetUids: [targetUid] };
    mismatchedReplayCount.state.pendingBattle = { attackerUid, replayTargetCount: 0, replayTargetUids: [] };
    mismatchedReplayTargets.state.currentAttack = { attackerUid, replayTargetCount: 1, replayTargetUids: [targetUid] };
    mismatchedReplayTargets.state.pendingBattle = { attackerUid, replayTargetCount: 1, replayTargetUids: [attackerUid] };
    mismatchedCurrentReplayShape.state.currentAttack = { attackerUid, replayTargetCount: 2, replayTargetUids: [targetUid] };
    mismatchedCurrentReplayShape.state.pendingBattle = { attackerUid, replayTargetCount: 2, replayTargetUids: [targetUid] };
    mismatchedPendingReplayShape.state.currentAttack = { attackerUid, replayTargetCount: 1, replayTargetUids: [targetUid] };
    mismatchedPendingReplayShape.state.pendingBattle = { attackerUid, replayTargetCount: 2, replayTargetUids: [targetUid] };
    missingCurrentReplayTargets.state.currentAttack = { attackerUid, replayTargetCount: 1 };
    missingCurrentReplayTargets.state.pendingBattle = { attackerUid, replayTargetCount: 1 };
    missingPendingReplayCount.state.currentAttack = { attackerUid, replayTargetUids: [targetUid] };
    missingPendingReplayCount.state.pendingBattle = { attackerUid, replayTargetUids: [targetUid] };
    for (const snapshot of [mismatchedAttacker, mismatchedTarget, mismatchedReplayCount, mismatchedReplayTargets, mismatchedCurrentReplayShape, mismatchedPendingReplayShape, missingCurrentReplayTargets, missingPendingReplayCount]) snapshot.state.battleStep = "attack";

    expect(() => restoreDuel(mismatchedAttacker, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.attackerUid must match currentAttack");
    expect(() => restoreDuel(mismatchedTarget, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.targetUid must match currentAttack");
    expect(() => restoreDuel(mismatchedReplayCount, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.replayTargetCount must match currentAttack");
    expect(() => restoreDuel(mismatchedReplayTargets, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.replayTargetUids must match currentAttack");
    expect(() => restoreDuel(mismatchedCurrentReplayShape, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.replayTargetCount must match replayTargetUids length");
    expect(() => restoreDuel(mismatchedPendingReplayShape, createCardReader(cards))).toThrow("Malformed duel snapshot: state.pendingBattle.replayTargetCount must match replayTargetUids length");
    expect(() => restoreDuel(missingCurrentReplayTargets, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.replayTargetCount must be paired with replayTargetUids");
    expect(() => restoreDuel(missingPendingReplayCount, createCardReader(cards))).toThrow("Malformed duel snapshot: state.currentAttack.replayTargetCount must be paired with replayTargetUids");
  });
});

function putInBattlePhase(...snapshots: Array<ReturnType<typeof serializeDuel>>): void {
  for (const snapshot of snapshots) {
    snapshot.state.phase = "battle";
    snapshot.state.actionWindowId = Math.max(snapshot.state.actionWindowId, 1);
  }
}

function declareSnapshotAttack(attackerUid: string, ...snapshots: Array<ReturnType<typeof serializeDuel>>): void {
  for (const snapshot of snapshots) snapshot.state.attacksDeclared = [attackerUid];
}
