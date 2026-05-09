import { duelReason } from "#duel/reasons.js";
import { luaCardIsImmuneToEffect } from "#lua/card-effect-query-api.js";
import type { DuelCardInstance, DuelEffectContext, DuelSession } from "#duel/types.js";
import type { LuaEffectRecord } from "#lua/host-types.js";

export interface LuaMoveImmunityHostState {
  effects: Map<number, LuaEffectRecord>;
  activeLuaEffectId?: number | undefined;
  activeContext?: DuelEffectContext | undefined;
  pushEffectTable: (state: unknown, id: number) => void;
}

export function luaMoveBlockedByImmunity(L: unknown, session: DuelSession, hostState: LuaMoveImmunityHostState, card: DuelCardInstance, reason: number | undefined): boolean {
  if (((reason ?? 0) & duelReason.effect) === 0) return false;
  const activeEffect = hostState.activeLuaEffectId === undefined ? undefined : hostState.effects.get(hostState.activeLuaEffectId);
  return luaCardIsImmuneToEffect(L, session, hostState, card, activeEffect);
}
