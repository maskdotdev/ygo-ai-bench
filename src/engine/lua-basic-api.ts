import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installConstants(L: unknown): void {
  const constants: Record<string, number> = {
    LOCATION_DECK: 0x01,
    LOCATION_HAND: 0x02,
    LOCATION_MZONE: 0x04,
    LOCATION_SZONE: 0x08,
    LOCATION_ONFIELD: 0x0c,
    LOCATION_GRAVE: 0x10,
    LOCATION_REMOVED: 0x20,
    LOCATION_EXTRA: 0x40,
    POS_FACEUP_ATTACK: 0x1,
    POS_FACEDOWN_ATTACK: 0x2,
    POS_FACEUP_DEFENSE: 0x4,
    POS_FACEDOWN_DEFENSE: 0x8,
    TYPE_MONSTER: 0x1,
    TYPE_SPELL: 0x2,
    TYPE_TRAP: 0x4,
    TYPE_NORMAL: 0x10,
    TYPE_EFFECT: 0x20,
    TYPE_FUSION: 0x40,
    TYPE_RITUAL: 0x80,
    TYPE_TUNER: 0x1000,
    TYPE_SYNCHRO: 0x2000,
    TYPE_XYZ: 0x800000,
    TYPE_PENDULUM: 0x1000000,
    TYPE_LINK: 0x4000000,
    RACE_WARRIOR: 0x1,
    RACE_SPELLCASTER: 0x2,
    RACE_DRAGON: 0x2000,
    ATTRIBUTE_EARTH: 0x1,
    ATTRIBUTE_WATER: 0x2,
    ATTRIBUTE_FIRE: 0x4,
    ATTRIBUTE_WIND: 0x8,
    ATTRIBUTE_LIGHT: 0x10,
    ATTRIBUTE_DARK: 0x20,
    ATTRIBUTE_DIVINE: 0x40,
    CATEGORY_DESTROY: 0x1,
    CATEGORY_RELEASE: 0x2,
    CATEGORY_REMOVE: 0x4,
    CATEGORY_TOHAND: 0x8,
    CATEGORY_TODECK: 0x10,
    CATEGORY_TOGRAVE: 0x20,
    CATEGORY_SPECIAL_SUMMON: 0x40,
    CATEGORY_DRAW: 0x80,
    CATEGORY_SEARCH: 0x100,
    CATEGORY_DAMAGE: 0x200,
    CATEGORY_RECOVER: 0x400,
    CATEGORY_NEGATE: 0x1000,
    EFFECT_FLAG_CARD_TARGET: 0x10,
    EFFECT_FLAG_DAMAGE_STEP: 0x20,
    EFFECT_FLAG_DAMAGE_CAL: 0x40,
    EFFECT_FLAG_DELAY: 0x10000,
    TIMING_DRAW_PHASE: 0x1,
    TIMING_STANDBY_PHASE: 0x2,
    TIMING_MAIN_END: 0x4,
    TIMING_BATTLE_START: 0x8,
    TIMING_BATTLE_END: 0x10,
    TIMING_END_PHASE: 0x20,
    EFFECT_TYPE_IGNITION: 0x10,
    EFFECT_TYPE_TRIGGER_O: 0x20,
    EFFECT_TYPE_QUICK_O: 0x100,
    EVENT_FLIP: 1001,
    EVENT_SUMMON_SUCCESS: 0x40,
    EVENT_SPSUMMON_SUCCESS: 0x80,
    EVENT_TO_GRAVE: 0x400,
    EVENT_CHANGE_POS: 1016,
    EVENT_ATTACK_ANNOUNCE: 1130,
    EVENT_BATTLE_DESTROYED: 1140,
    REASON_EFFECT: 0x40,
    REASON_DESTROY: 0x1,
    RESET_EVENT: 0x1000,
    RESETS_STANDARD: 0x2000,
  };
  for (const [name, value] of Object.entries(constants)) {
    lua.lua_pushinteger(L, value);
    lua.lua_setglobal(L, to_luastring(name));
  }
}

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

export function installAuxApi(L: unknown, readLuaError: (state: unknown) => string): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const code = lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0;
    const index = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, code * 16 + index);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Stringid"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, true);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("TRUE"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, false);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("FALSE"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (!lua.lua_isfunction(state, 1)) {
      lua.lua_pushnil(state);
      return 1;
    }
    const extraArgCount = lua.lua_gettop(state) - 1;
    const refs: number[] = [];
    lua.lua_pushvalue(state, 1);
    refs.push(lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX));
    for (let index = 0; index < extraArgCount; index += 1) {
      lua.lua_pushvalue(state, index + 2);
      refs.push(lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX));
    }
    lua.lua_pushjsfunction(state, (callState: unknown) => {
      lua.lua_rawgeti(callState, lua.LUA_REGISTRYINDEX, refs[0]);
      lua.lua_pushvalue(callState, 1);
      for (let index = 1; index < refs.length; index += 1) lua.lua_rawgeti(callState, lua.LUA_REGISTRYINDEX, refs[index]);
      const status = lua.lua_pcall(callState, refs.length, 1, 0);
      if (status !== lua.LUA_OK) return lauxlib.luaL_error(callState, to_luastring(readLuaError(callState)));
      return 1;
    });
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("FilterBoolFunction"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (!lua.lua_isfunction(state, 1)) {
      lua.lua_pushnil(state);
      return 1;
    }
    lua.lua_pushvalue(state, 1);
    const ref = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    lua.lua_pushjsfunction(state, (callState: unknown) => {
      const argCount = lua.lua_gettop(callState);
      lua.lua_rawgeti(callState, lua.LUA_REGISTRYINDEX, ref);
      for (let index = 1; index <= argCount; index += 1) lua.lua_pushvalue(callState, index);
      const status = lua.lua_pcall(callState, argCount, 1, 0);
      if (status !== lua.LUA_OK) return lauxlib.luaL_error(callState, to_luastring(readLuaError(callState)));
      return 1;
    });
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("NecroValleyFilter"));
  lua.lua_setglobal(L, to_luastring("aux"));
}
