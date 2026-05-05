import { clearChainLimits } from "#duel/chain-limits.js";
import type { DuelState } from "#duel/types.js";

export function clearEndedDuelPendingState(state: DuelState): void {
  state.chain = [];
  state.chainPasses = [];
  clearChainLimits(state);
  state.pendingTriggers = [];
  delete state.prompt;
  delete state.waitingFor;
  delete state.currentAttack;
  delete state.pendingBattle;
  delete state.battleStep;
  delete state.battleWindow;
  state.attackPasses = [];
  state.damagePasses = [];
}
