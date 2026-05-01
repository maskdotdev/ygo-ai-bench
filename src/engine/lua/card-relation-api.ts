import fengari from "fengari";
import { readTableNumberField, readTableStringField } from "#lua/api-utils.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardRelationApi<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushCreateEffectRelation(state, session));
  lua.lua_setfield(L, -2, to_luastring("CreateEffectRelation"));
  lua.lua_pushcfunction(L, (state: unknown) => pushReleaseEffectRelation(state, session));
  lua.lua_setfield(L, -2, to_luastring("ReleaseEffectRelation"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetMarkedEffects(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetMarkedEffects"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsRelateToCard(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsRelateToCard"));
}

function pushCreateEffectRelation(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const effectId = readTableNumberField(L, 2, "__effect_id");
  if (card && effectId !== undefined) {
    card.effectRelationIds = card.effectRelationIds ?? [];
    if (!card.effectRelationIds.includes(effectId)) card.effectRelationIds.push(effectId);
  }
  return 0;
}

function pushReleaseEffectRelation(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const effectId = readTableNumberField(L, 2, "__effect_id");
  if (card && effectId !== undefined) card.effectRelationIds = (card.effectRelationIds ?? []).filter((id) => id !== effectId);
  return 0;
}

function pushGetMarkedEffects<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const code = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  lua.lua_newtable(L);
  if (!card || code === undefined) return 1;
  let index = 1;
  for (const effect of hostState.effects.values()) {
    if (effect.sourceUid !== card.uid || effect.code !== code || ((effect.typeFlags ?? 0) & 0x1) === 0 || effect.labelObjectId === undefined) continue;
    hostState.pushEffectTable(L, effect.labelObjectId);
    lua.lua_rawseti(L, -2, index);
    index += 1;
  }
  return 1;
}

function pushIsRelateToCard(L: unknown, session: DuelSession): number {
  const source = readCard(L, session, 1);
  const target = readCard(L, session, 2);
  lua.lua_pushboolean(L, Boolean(source && target && isOnField(source) && isOnField(target)));
  return 1;
}

function readCard(L: unknown, session: DuelSession, index = 1): DuelCardInstance | undefined {
  const uid = readTableStringField(L, index, "__duel_uid");
  return uid ? session.state.cards.find((card) => card.uid === uid) : undefined;
}

function isOnField(card: DuelCardInstance): boolean {
  return card.location === "monsterZone" || card.location === "spellTrapZone";
}
