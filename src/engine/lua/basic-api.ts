import fengari from "fengari";

export { installAuxApi } from "#lua/aux-api.js";
export { installConstants } from "#lua/basic-constants-api.js";

const { lua, to_luastring } = fengari;

export function installDebugApi(L: unknown, messages: string[]): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const message = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : "";
    messages.push(message);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("Message"));
  lua.lua_setglobal(L, to_luastring("Debug"));
}
