import fengari from "fengari";

const { lua, to_luastring } = fengari;

export interface LuaDuelPromptApiHostState {
  messages: string[];
}

export function installDuelPromptApi(L: unknown, hostState: LuaDuelPromptApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const message = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : "";
    hostState.messages.push(message);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("DebugMessage"));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("Hint"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, lua.lua_gettop(state) >= 2 ? 0 : -1);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectOption"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, true);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectYesNo"));
  pushAnnouncementHelper(L, "AnnounceNumber");
  pushAnnouncementHelper(L, "AnnounceCard");
  pushAnnouncementHelper(L, "AnnounceType");
  pushAnnouncementHelper(L, "AnnounceRace");
  pushAnnouncementHelper(L, "AnnounceAttribute");
}

function pushAnnouncementHelper(L: unknown, fieldName: string): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstAnnouncementValue(state, 0));
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushFirstAnnouncementValue(L: unknown, fallback: number): number {
  const value = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : fallback;
  lua.lua_pushinteger(L, value);
  return 1;
}
