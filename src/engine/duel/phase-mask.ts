import { currentBattleStep } from "#duel/battle-window-state.js";
import type { DuelPhase } from "#duel/types.js";
import type { DuelState } from "#duel/types.js";

export function phaseMask(phase: DuelPhase | undefined): number {
  if (phase === "draw") return 0x1;
  if (phase === "standby") return 0x2;
  if (phase === "main1") return 0x4;
  if (phase === "battle") return 0x80;
  if (phase === "main2") return 0x100;
  if (phase === "end") return 0x200;
  return 0;
}

export function currentDuelPhaseMask(state: DuelState): number {
  if (isBattleStartPhase(state)) return 0x8;
  if (state.phase === "battle" && currentBattleStep(state) === "attack") return 0x10;
  if (state.phase === "battle" && currentBattleStep(state) === "damage") return 0x20;
  if (state.phase === "battle" && currentBattleStep(state) === "damageCalculation") return 0x40;
  return phaseMask(state.phase);
}

export function isBattleStartPhase(state: DuelState): boolean {
  return state.phase === "battle" && currentBattleStep(state) === undefined && !state.currentAttack && !state.pendingBattle && state.attacksDeclared.length === 0;
}

export function isBattleEndPhase(state: DuelState): boolean {
  return state.phase === "battle" && currentBattleStep(state) === undefined && !isBattleStartPhase(state);
}
