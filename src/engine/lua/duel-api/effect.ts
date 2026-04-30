import fengari from "fengari";
import { readTableNumberField } from "#lua/api-utils.js";
import type { PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelEffectApiHostState {
  registerEffect: (state: unknown, id: number, player: PlayerId) => boolean;
}

export function installDuelEffectApi(L: unknown, hostState: LuaDuelEffectApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const effectId = readTableNumberField(state, 1, "__effect_id");
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0);
    lua.lua_pushboolean(state, effectId !== undefined && hostState.registerEffect(state, effectId, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterEffect"));
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
