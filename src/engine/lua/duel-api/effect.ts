import fengari from "fengari";
import { readTableNumberField } from "#lua/api-utils.js";
import type { DuelEffectContext, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelEffectApiHostState {
  activeContext?: DuelEffectContext | undefined;
  pushEffectTable: (state: unknown, id: number) => void;
  registerEffect: (state: unknown, id: number, player: PlayerId) => boolean;
}

export function installDuelEffectApi(L: unknown, session: DuelSession, hostState: LuaDuelEffectApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const effectId = readTableNumberField(state, 1, "__effect_id");
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0);
    lua.lua_pushboolean(state, effectId !== undefined && hostState.registerEffect(state, effectId, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, getReasonPlayer(session, hostState));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetReasonPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => pushReasonEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetReasonEffect"));
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function getReasonPlayer(session: DuelSession, hostState: LuaDuelEffectApiHostState): PlayerId {
  return hostState.activeContext?.eventCard?.reasonPlayer ?? hostState.activeContext?.eventCard?.controller ?? hostState.activeContext?.player ?? session.state.turnPlayer;
}

function pushReasonEffect(L: unknown, session: DuelSession, hostState: LuaDuelEffectApiHostState): number {
  const effectId = (hostState.activeContext?.chainLink ?? session.state.chain[session.state.chain.length - 1])?.effectId;
  const id = Number(effectId?.match(/^lua-(\d+)/)?.[1]);
  if (Number.isFinite(id)) hostState.pushEffectTable(L, id);
  else lua.lua_pushnil(L);
  return 1;
}
