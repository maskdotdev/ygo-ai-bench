import type { DuelEffectDefinition, DuelState } from "#duel/types.js";

const effectFlagNoTurnReset = 0x400000;

export function canUseEffectCount(state: DuelState, effect: DuelEffectDefinition): boolean {
  const limit = effectCountLimit(effect);
  if (limit <= 0) return true;
  return state.usedCountKeys.filter((key) => key === effectCountKey(state, effect)).length < limit;
}

export function markEffectUsed(state: DuelState, effect: DuelEffectDefinition): void {
  if (effectCountLimit(effect) <= 0) return;
  const key = effectCountKey(state, effect);
  state.usedCountKeys.push(key);
}

export function clearEffectCountUsage(state: DuelState, effect: DuelEffectDefinition): void {
  if (effectCountLimit(effect) <= 0) return;
  const key = effectCountKey(state, effect);
  state.usedCountKeys = state.usedCountKeys.filter((usedKey) => usedKey !== key);
}

function effectCountLimit(effect: DuelEffectDefinition): number {
  if (effect.countLimit !== undefined) return effect.countLimit;
  return effect.oncePerTurn ? 1 : 0;
}

function effectCountKey(state: DuelState, effect: DuelEffectDefinition): string {
  if (effect.countLimitCode !== undefined) {
    const scope = (effect.countLimitCode & 0x2) !== 0 ? "duel" : `turn-${state.turn}`;
    return `${scope}:${effect.controller}:code-${effect.countLimitCode}`;
  }
  const scope = ((effect.property ?? 0) & effectFlagNoTurnReset) !== 0 ? "no-turn-reset" : `turn-${state.turn}`;
  return `${scope}:${effect.controller}:${effect.sourceUid}:${effect.id}`;
}
