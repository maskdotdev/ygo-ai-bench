import fengari from "fengari";
import { detachDuelOverlayMaterials } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { readCardUid } from "#lua/api-utils.js";
import { pushGroupTable } from "#lua/group-api.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";

const { lua, to_luastring } = fengari;

export function installCardOverlayApi<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, readCard(state, session)?.overlayUids.length ?? 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetOverlayCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    pushGroupTable(state, card?.overlayUids ?? []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetOverlayGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveOverlayCard(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RemoveOverlayCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckRemoveOverlayCard(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckRemoveOverlayCard"));
}

function pushRemoveOverlayCard<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const player = lua.lua_isnumber(L, 2) ? normalizePlayer(lua.lua_tointeger(L, 2)) : card?.controller ?? 0;
  const min = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  const max = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : min;
  const reason = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : duelReason.cost;
  const detached = card ? detachOverlayRange(session, card, min, max, player, reason) : [];
  setOperatedUids(hostState, detached.map((material) => material.uid));
  lua.lua_pushinteger(L, detached.length);
  return 1;
}

function pushCheckRemoveOverlayCard(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const count = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1);
  lua.lua_pushboolean(L, Boolean(card && card.overlayUids.length >= count));
  return 1;
}

function detachOverlayRange(session: DuelSession, card: DuelCardInstance, min: number, max: number, player: PlayerId, reason: number): DuelCardInstance[] {
  const count = Math.min(Math.max(min, 0), Math.max(max, 0), card.overlayUids.length);
  if (count < min) return [];
  try {
    return detachDuelOverlayMaterials(session.state, card.uid, count, player, reason);
  } catch {
    return [];
  }
}

function setOperatedUids<EffectRecord extends LuaCardApiEffectRecord>(hostState: LuaCardApiState<EffectRecord>, uids: string[]): void {
  hostState.operatedUids?.splice(0, hostState.operatedUids.length, ...uids);
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
