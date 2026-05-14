import type { BattleStep, DuelPhase, DuelStatus } from "#duel/types.js";

export const duelPhases: readonly DuelPhase[] = ["draw", "standby", "main1", "battle", "main2", "end"];
export const battleSteps: readonly BattleStep[] = ["attack", "damage", "damageCalculation"];
export const duelStatuses: readonly DuelStatus[] = ["setup", "awaiting", "resolving", "ended"];

const duelPhaseSet = new Set<DuelPhase>(duelPhases);
const battleStepSet = new Set<BattleStep>(battleSteps);
const duelStatusSet = new Set<DuelStatus>(duelStatuses);

export function isDuelPhase(value: unknown): value is DuelPhase {
  return duelPhaseSet.has(value as DuelPhase);
}

export function isBattleStep(value: unknown): value is BattleStep {
  return battleStepSet.has(value as BattleStep);
}

export function isDuelStatus(value: unknown): value is DuelStatus {
  return duelStatusSet.has(value as DuelStatus);
}
