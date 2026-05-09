import { duelReason } from "#duel/reasons.js";
import { luaCardIsImmuneToEffect } from "#lua/card-effect-query-api.js";
import type { DuelCardInstance, DuelEffectContext, DuelSession } from "#duel/types.js";
import type { LuaCardApiEffectRecord } from "#lua/card-api-types.js";
import type { LuaEffectRecord } from "#lua/host-types.js";

export interface LuaMoveImmunityHostState<EffectRecord extends LuaCardApiEffectRecord = LuaEffectRecord> {
  effects: Map<number, EffectRecord>;
  activeLuaEffectId?: number | undefined;
  activeContext?: DuelEffectContext | undefined;
  pushEffectTable: (state: unknown, id: number) => void;
}

export function luaMoveBlockedByImmunity<EffectRecord extends LuaCardApiEffectRecord = LuaEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaMoveImmunityHostState<EffectRecord>,
  card: DuelCardInstance,
  reason: number | undefined,
): boolean {
  if (((reason ?? 0) & duelReason.effect) === 0) return false;
  const activeEffect = hostState.activeLuaEffectId === undefined ? undefined : hostState.effects.get(hostState.activeLuaEffectId);
  return luaCardIsImmuneToEffect(L, session, hostState, card, activeEffect);
}
