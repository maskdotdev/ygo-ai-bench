import type { PlayerId } from "#duel/types.js";

export function assertSnapshotBattlePassWindows(state: Record<string, unknown>): void {
  if (state.pendingBattle === undefined && (state.attackPasses as unknown[]).length > 0) throw new Error("Malformed duel snapshot: state.attackPasses requires a pending battle");
  if (state.pendingBattle === undefined && (state.damagePasses as unknown[]).length > 0) throw new Error("Malformed duel snapshot: state.damagePasses requires a pending battle");
  if ((state.attackPasses as PlayerId[]).length === 2) throw new Error("Malformed duel snapshot: state.attackPasses must not contain both players");
  if ((state.damagePasses as PlayerId[]).length === 2) throw new Error("Malformed duel snapshot: state.damagePasses must not contain both players");
  const battleStep = isRecord(state.battleWindow) ? state.battleWindow.step : state.battleStep;
  if ((state.attackPasses as unknown[]).length > 0 && battleStep !== "attack") throw new Error("Malformed duel snapshot: state.attackPasses requires an attack battle step");
  if ((state.damagePasses as unknown[]).length > 0 && battleStep !== "damage" && battleStep !== "damageCalculation") throw new Error("Malformed duel snapshot: state.damagePasses requires a damage battle step");
}

export function assertSnapshotBattleStateConsistency(state: Record<string, unknown>): void {
  if (state.currentAttack === undefined && state.pendingBattle === undefined) {
    if (state.battleStep !== undefined) throw new Error("Malformed duel snapshot: state.battleStep requires battle state");
    return;
  }
  if (state.phase !== "battle") throw new Error("Malformed duel snapshot: battle state requires the battle phase");
  if (state.status !== "awaiting" && state.status !== "resolving") throw new Error("Malformed duel snapshot: battle state requires an active duel");
  if (!isRecord(state.currentAttack)) throw new Error("Malformed duel snapshot: state.currentAttack is required with pendingBattle");
  if (!isRecord(state.pendingBattle)) throw new Error("Malformed duel snapshot: state.pendingBattle is required with currentAttack");
  if (!isRecord(state.currentAttack) || !isRecord(state.pendingBattle)) return;
  if (!(state.attacksDeclared as unknown[]).includes(state.currentAttack.attackerUid)) throw new Error("Malformed duel snapshot: state.currentAttack.attackerUid must be declared as an attack");
  if (state.currentAttack.battleDamageOverrides !== undefined) throw new Error("Malformed duel snapshot: state.currentAttack must not contain battleDamageOverrides");
  if (state.currentAttack.resultApplied !== undefined) throw new Error("Malformed duel snapshot: state.currentAttack must not contain resultApplied");
  if (state.currentAttack.deferredBattleDestroyed !== undefined) throw new Error("Malformed duel snapshot: state.currentAttack must not contain deferredBattleDestroyed");
  if (state.battleStep === undefined && state.battleWindow === undefined) throw new Error("Malformed duel snapshot: battle state requires battleStep");
  assertReplayTargetCountMatchesUids(state.currentAttack, "state.currentAttack");
  assertReplayTargetCountMatchesUids(state.pendingBattle, "state.pendingBattle");
  if (state.currentAttack.attackerUid !== state.pendingBattle.attackerUid) throw new Error("Malformed duel snapshot: state.pendingBattle.attackerUid must match currentAttack");
  if (state.currentAttack.targetUid !== state.pendingBattle.targetUid) throw new Error("Malformed duel snapshot: state.pendingBattle.targetUid must match currentAttack");
  if (state.currentAttack.replayTargetCount !== state.pendingBattle.replayTargetCount) throw new Error("Malformed duel snapshot: state.pendingBattle.replayTargetCount must match currentAttack");
  if (!sameOptionalStringArray(state.currentAttack.replayTargetUids, state.pendingBattle.replayTargetUids)) throw new Error("Malformed duel snapshot: state.pendingBattle.replayTargetUids must match currentAttack");
}

export function assertSnapshotBattleWindowContext(state: Record<string, unknown>): void {
  if (state.battleWindow === undefined) return;
  if (state.pendingBattle === undefined && state.currentAttack === undefined) throw new Error("Malformed duel snapshot: state.battleWindow requires battle state");
  if (state.battleStep === undefined) throw new Error("Malformed duel snapshot: state.battleStep is required with battleWindow");
  if (isRecord(state.battleWindow) && typeof state.actionWindowId === "number" && typeof state.battleWindow.id === "number" && state.battleWindow.id > state.actionWindowId) {
    throw new Error("Malformed duel snapshot: state.battleWindow.id must not exceed actionWindowId");
  }
  assertBattleWindowMatchesBattleState(state);
  if (isRecord(state.battleWindow) && state.battleWindow.attackNegated) throw new Error("Malformed duel snapshot: state.battleWindow.attackNegated cannot be pending");
  assertReplayDecisionWindowMatchesAttacker(state);
  if (state.battleStep !== undefined && isRecord(state.battleWindow) && state.battleStep !== state.battleWindow.step) throw new Error("Malformed duel snapshot: state.battleStep must match battleWindow.step");
  if (battleWindowIsActivePendingWindow(state) && state.status !== "awaiting") throw new Error("Malformed duel snapshot: active battleWindow requires an awaiting duel");
  if (battleWindowIsActivePendingWindow(state) && isRecord(state.battleWindow) && state.waitingFor !== state.battleWindow.responsePlayer) throw new Error("Malformed duel snapshot: state.waitingFor must match battleWindow.responsePlayer");
  assertActiveBattleResponsePlayerHasNotPassed(state);
}

function battleWindowIsActivePendingWindow(state: Record<string, unknown>): boolean {
  return state.prompt === undefined && (state.chain as unknown[]).length === 0 && (state.pendingTriggers as unknown[]).length === 0;
}

function assertBattleWindowMatchesBattleState(state: Record<string, unknown>): void {
  if (!isRecord(state.battleWindow)) return;
  const battle = isRecord(state.pendingBattle) ? state.pendingBattle : state.currentAttack;
  if (!isRecord(battle)) return;
  if (state.battleWindow.attackerUid !== battle.attackerUid) throw new Error("Malformed duel snapshot: state.battleWindow.attackerUid must match battle state");
  if (state.battleWindow.targetUid !== battle.targetUid) throw new Error("Malformed duel snapshot: state.battleWindow.targetUid must match battle state");
}

function assertReplayDecisionWindowMatchesAttacker(state: Record<string, unknown>): void {
  if (!isRecord(state.battleWindow) || state.battleWindow.kind !== "replayDecision") return;
  const attacker = findSnapshotCard(state, state.battleWindow.attackerUid);
  if (attacker?.location !== "monsterZone") throw new Error("Malformed duel snapshot: state.battleWindow.attackerUid must reference a monster-zone card for replay decision");
  if (state.battleWindow.responsePlayer !== attacker.controller) throw new Error("Malformed duel snapshot: state.battleWindow.responsePlayer must match replay attacker controller");
}

function assertActiveBattleResponsePlayerHasNotPassed(state: Record<string, unknown>): void {
  if (!battleWindowIsActivePendingWindow(state) || !isRecord(state.battleWindow)) return;
  const responsePlayer = state.battleWindow.responsePlayer as PlayerId;
  if (state.battleWindow.step === "attack" && (state.attackPasses as PlayerId[]).includes(responsePlayer)) {
    throw new Error("Malformed duel snapshot: state.battleWindow.responsePlayer must not be included in attackPasses");
  }
  if ((state.battleWindow.step === "damage" || state.battleWindow.step === "damageCalculation") && (state.damagePasses as PlayerId[]).includes(responsePlayer)) {
    throw new Error("Malformed duel snapshot: state.battleWindow.responsePlayer must not be included in damagePasses");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function findSnapshotCard(state: Record<string, unknown>, uid: unknown): Record<string, unknown> | undefined {
  return (state.cards as unknown[]).find((card) => isRecord(card) && card.uid === uid) as Record<string, unknown> | undefined;
}

function assertReplayTargetCountMatchesUids(battle: Record<string, unknown>, path: string): void {
  if ((battle.replayTargetCount === undefined) !== (battle.replayTargetUids === undefined)) throw new Error(`Malformed duel snapshot: ${path}.replayTargetCount must be paired with replayTargetUids`);
  if (typeof battle.replayTargetCount !== "number" || !Array.isArray(battle.replayTargetUids)) return;
  if (battle.replayTargetCount !== battle.replayTargetUids.length) throw new Error(`Malformed duel snapshot: ${path}.replayTargetCount must match replayTargetUids length`);
}

function sameOptionalStringArray(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((uid, index) => uid === right[index]);
}
