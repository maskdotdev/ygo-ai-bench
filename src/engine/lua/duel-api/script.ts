import fengari from "fengari";
import type { LuaScriptLoadResult } from "#lua/host.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelScriptApiHostState {
  loadScriptFile(name: string, forced?: boolean): LuaScriptLoadResult;
}

export function installDuelScriptApi(L: unknown, hostState: LuaDuelScriptApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const name = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : undefined;
    if (!name) {
      lua.lua_pushboolean(state, false);
      return 1;
    }
    const forced = Boolean(lua.lua_toboolean(state, 2));
    const result = hostState.loadScriptFile(name, forced);
    lua.lua_pushboolean(state, result.ok);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("LoadScript"));
}
