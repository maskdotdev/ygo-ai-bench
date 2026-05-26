import fengari from "fengari";
import { registerEffect } from "#duel/core.js";
import { readTableNumberField, readTableStringField } from "#lua/api-utils.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;
const luaEffectTypeField = 0x2;
const luaEffectTypeGrant = 0x2000;

export function installCardEffectRegistrationApi<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
  toDuelEffect: (card: DuelCardInstance, luaEffect: EffectRecord, state: unknown) => DuelEffectDefinition,
): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const cardUid = readTableStringField(state, 1, "__duel_uid");
    const effectId = readTableNumberField(state, 2, "__effect_id");
    const card = cardUid ? session.state.cards.find((candidate) => candidate.uid === cardUid) : undefined;
    const luaEffect = effectId === undefined ? undefined : hostState.effects.get(effectId);
    if (!card || !luaEffect) return 0;
    registerEffect(session, toDuelEffect(card, luaEffect, state));
    if ((luaEffect.typeFlags ?? 0) & luaEffectTypeField && (luaEffect.typeFlags ?? 0) & luaEffectTypeGrant && luaEffect.labelObjectId !== undefined) {
      const labelEffect = hostState.effects.get(luaEffect.labelObjectId);
      if (labelEffect) {
        labelEffect.ownerPlayer = luaEffect.ownerPlayer ?? card.controller;
        registerEffect(session, toDuelEffect(card, labelEffect, state));
      }
    }
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterEffect"));
}
