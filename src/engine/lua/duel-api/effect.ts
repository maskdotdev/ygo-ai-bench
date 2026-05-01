import fengari from "fengari";
import { readTableNumberField } from "#lua/api-utils.js";
import type { DuelEffectContext, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelEffectApiHostState {
  activeContext?: DuelEffectContext | undefined;
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
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function getReasonPlayer(session: DuelSession, hostState: LuaDuelEffectApiHostState): PlayerId {
  return hostState.activeContext?.eventCard?.reasonPlayer ?? hostState.activeContext?.eventCard?.controller ?? hostState.activeContext?.player ?? session.state.turnPlayer;
}
