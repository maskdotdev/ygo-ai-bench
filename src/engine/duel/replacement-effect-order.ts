import type { ContinuousEffectMatch } from "#duel/continuous-effects.js";
import type { DuelEffectDefinition, DuelState } from "#duel/types.js";

export function orderReplacementEffects(state: DuelState, matches: ContinuousEffectMatch[]): ContinuousEffectMatch[] {
  return matches
    .map((match, index) => ({ match, index }))
    .sort((left, right) => {
      const leftGroup = replacementOrderGroup(state, left.match);
      const rightGroup = replacementOrderGroup(state, right.match);
      if (leftGroup !== rightGroup) return leftGroup - rightGroup;
      const leftId = luaEffectOrderId(left.match.effect);
      const rightId = luaEffectOrderId(right.match.effect);
      if (leftId !== undefined && rightId !== undefined && leftId !== rightId) return leftId - rightId;
      return left.index - right.index;
    })
    .map(({ match }) => match);
}

function replacementOrderGroup(state: DuelState, match: ContinuousEffectMatch): number {
  if (!isLuaFieldContinuousEffect(match.effect)) return 2;
  const effectPlayer = match.effect.ownerPlayer ?? match.source.controller;
  return effectPlayer === state.turnPlayer ? 0 : 1;
}

function isLuaFieldContinuousEffect(effect: DuelEffectDefinition): boolean {
  return ((effect.luaTypeFlags ?? 0) & 0x2) !== 0;
}

function luaEffectOrderId(effect: DuelEffectDefinition): number | undefined {
  const id = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? id : undefined;
}
