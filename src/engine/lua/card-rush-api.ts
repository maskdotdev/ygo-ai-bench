import fengari from "fengari";
import { getDuelFlagEffectCount, registerDuelFlagEffect } from "#duel/flags.js";
import { matchingLuaEffects } from "#lua/card-effect-query-api.js";
import { readTableStringField } from "#lua/api-utils.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;
const flagNegateContinuousRushEffect = 160015136;

export function installCardRushApi<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
): void {
  pushBooleanGetter(L, "IsMaximumMode", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeCenter", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeLeft", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeRight", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeSide", session, () => false);
  pushBooleanGetter(L, "IsNotMaximumModeSide", session, () => true);
  pushBooleanGetter(L, "WasMaximumMode", session, () => false);
  pushBooleanGetter(L, "WasMaximumModeCenter", session, () => false);
  pushBooleanGetter(L, "WasMaximumModeSide", session, () => false);
  lua.lua_pushcfunction(L, (state: unknown) => pushCanChangeRaceRush(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("CanChangeIntoTypeRush"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanChangeAttributeRush(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("CanChangeIntoAttributeRush"));
  lua.lua_pushcfunction(L, (state: unknown) => pushHasContinuousRushEffect(state, session));
  lua.lua_setfield(L, -2, to_luastring("HasContinuousRushEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNegateContinuousRushEffects(state, session));
  lua.lua_setfield(L, -2, to_luastring("NegateContinuousRushEffects"));
}

function pushCanChangeRaceRush<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const requested = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const turnValue = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  lua.lua_pushboolean(L, Boolean(card && requested !== undefined && canChangeRushTrait(requested, card.data.race ?? 0, matchingLuaEffects(session.state, card, 122, hostState), turnValue)));
  return 1;
}

function pushCanChangeAttributeRush<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const requested = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const turnValue = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  lua.lua_pushboolean(L, Boolean(card && requested !== undefined && canChangeRushTrait(requested, card.data.attribute ?? 0, matchingLuaEffects(session.state, card, 127, hostState), turnValue)));
  return 1;
}

function canChangeRushTrait<EffectRecord extends LuaCardApiEffectRecord>(
  requested: number,
  originalValue: number,
  changeEffects: EffectRecord[],
  turnValue: number,
): boolean {
  const currentValue = changeEffects.find((effect) => effect.value !== undefined)?.value ?? originalValue;
  if ((currentValue & requested) === 0) return true;
  if ((originalValue & requested) !== 0) return false;
  if (changeEffects.length === 0) return true;
  return !changeEffects.some((effect) => !isFieldOrEquipEffect(effect) && (effect.reset?.count ?? 0) >= turnValue);
}

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function isFieldOrEquipEffect(effect: LuaCardApiEffectRecord): boolean {
  return effect.typeFlags === 0x2 || effect.typeFlags === 0x4;
}

function pushHasContinuousRushEffect(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  lua.lua_pushboolean(L, Boolean(card && hasContinuousRushEffect(session, card)));
  return 1;
}

function hasContinuousRushEffect(session: DuelSession, card: DuelCardInstance): boolean {
  if (getDuelFlagEffectCount(session.state, { ownerType: "card", ownerId: card.uid }, 160015036) > 0) return true;
  return false;
}

function pushNegateContinuousRushEffects(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const resets = lua.lua_isnumber(L, 2) ? Math.trunc(lua.lua_tonumber(L, 2)) : 0;
  if (card) registerDuelFlagEffect(session.state, { ownerType: "card", ownerId: card.uid }, flagNegateContinuousRushEffect, resets, 0, 0);
  return 0;
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readTableStringField(L, 1, "__duel_uid");
  return uid ? session.state.cards.find((card) => card.uid === uid) : undefined;
}
