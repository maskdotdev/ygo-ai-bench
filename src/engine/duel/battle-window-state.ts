import type { BattleStep, BattleWindowKind, BattleWindowState, DuelState, PlayerId } from "#duel/types.js";

export const battleWindowKinds: readonly BattleWindowKind[] = [
  "attackDeclaration",
  "attackTargetConfirmation",
  "attackNegationResponse",
  "replayDecision",
  "startDamageStep",
  "beforeDamageCalculation",
  "duringDamageCalculation",
  "afterDamageCalculation",
  "endDamageStep",
];

const battleWindowKindSet = new Set<BattleWindowKind>(battleWindowKinds);

export function isBattleWindowKind(value: unknown): value is BattleWindowKind {
  return battleWindowKindSet.has(value as BattleWindowKind);
}

export function openBattleWindowState(state: DuelState, kind: BattleWindowKind, step: BattleStep, responsePlayer: PlayerId): BattleWindowState | undefined {
  const battle = state.pendingBattle ?? state.currentAttack;
  if (!battle) {
    clearBattleWindowState(state);
    return undefined;
  }
  state.battleStep = step;
  state.battleWindow = {
    id: state.actionWindowId,
    kind,
    step,
    attackerUid: battle.attackerUid,
    ...(battle.targetUid === undefined ? {} : { targetUid: battle.targetUid }),
    responsePlayer,
    attackNegated: false,
  };
  return state.battleWindow;
}

export function setBattleWindowResponsePlayer(state: DuelState, responsePlayer: PlayerId): void {
  if (state.battleWindow) state.battleWindow = { ...state.battleWindow, responsePlayer };
}

export function markBattleWindowAttackNegated(state: DuelState): void {
  if (state.battleWindow) state.battleWindow = { ...state.battleWindow, attackNegated: true };
}

export function clearBattleWindowState(state: DuelState): void {
  delete state.battleStep;
  delete state.battleWindow;
}

export function currentBattleStep(state: DuelState): BattleStep | undefined {
  return state.battleWindow?.step ?? state.battleStep;
}

export function currentBattleWindowKind(state: DuelState): BattleWindowKind | undefined {
  if (state.battleWindow) return state.battleWindow.kind;
  if (state.battleStep === "attack") return "attackNegationResponse";
  if (state.battleStep === "damage") return "startDamageStep";
  if (state.battleStep === "damageCalculation") return "duringDamageCalculation";
  return undefined;
}

export function isBattleDamageStep(state: DuelState): boolean {
  const step = currentBattleStep(state);
  return step === "damage" || step === "damageCalculation";
}

export function isBattleDamageCalculation(state: DuelState): boolean {
  return currentBattleStep(state) === "damageCalculation";
}

export function isBattleAttackStep(state: DuelState): boolean {
  return currentBattleStep(state) === "attack";
}

export function copyBattleWindowState(window: BattleWindowState): BattleWindowState {
  return { ...window };
}
