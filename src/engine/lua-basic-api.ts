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
    HINT_SELECTMSG: 0x10,
    HINTMSG_RELEASE: 500,
    HINTMSG_DESTROY: 501,
    HINTMSG_REMOVE: 502,
    HINTMSG_TOHAND: 503,
    HINTMSG_TODECK: 504,
    HINTMSG_TOGRAVE: 505,
    HINTMSG_SPSUMMON: 506,
    CHAININFO_TRIGGERING_EFFECT: 0x1,
    CHAININFO_TRIGGERING_PLAYER: 0x2,
    CHAININFO_TRIGGERING_CONTROLER: 0x4,
    CHAININFO_TRIGGERING_LOCATION: 0x8,
    CHAININFO_TRIGGERING_CARD: 0x10,
    CHAININFO_TARGET_CARDS: 0x20,
    EFFECT_TYPE_SINGLE: 0x1,
    EFFECT_TYPE_FIELD: 0x2,
    EFFECT_TYPE_EQUIP: 0x4,
    EFFECT_TYPE_ACTIONS: 0x8,
    EFFECT_TYPE_ACTIVATE: 0x10,
    EFFECT_TYPE_FLIP: 0x20,
    EFFECT_TYPE_IGNITION: 0x40,
    EFFECT_TYPE_TRIGGER_O: 0x80,
    EFFECT_TYPE_QUICK_O: 0x100,
    EFFECT_TYPE_TRIGGER_F: 0x200,
    EFFECT_TYPE_QUICK_F: 0x400,
    EFFECT_TYPE_CONTINUOUS: 0x800,
    EFFECT_TYPE_XMATERIAL: 0x1000,
    EFFECT_TYPE_GRANT: 0x2000,
    EFFECT_TYPE_TARGET: 0x4000,
    SUMMON_TYPE_NORMAL: 0x10000000,
    SUMMON_TYPE_ADVANCE: 0x11000000,
    SUMMON_TYPE_TRIBUTE: 0x11000000,
    SUMMON_TYPE_FLIP: 0x20000000,
    SUMMON_TYPE_SPECIAL: 0x40000000,
    SUMMON_TYPE_FUSION: 0x43000000,
    SUMMON_TYPE_RITUAL: 0x45000000,
    SUMMON_TYPE_SYNCHRO: 0x46000000,
    SUMMON_TYPE_XYZ: 0x49000000,
    SUMMON_TYPE_LINK: 0x4c000000,
    EVENT_FLIP: 1001,
    EVENT_SUMMON_SUCCESS: 0x40,
    EVENT_SPSUMMON_SUCCESS: 0x80,
    EVENT_TO_GRAVE: 0x400,
    EVENT_CHANGE_POS: 1016,
    EVENT_ATTACK_ANNOUNCE: 1130,
    EVENT_BATTLE_DESTROYED: 1140,
    REASON_EFFECT: 0x40,
    REASON_COST: 0x80,
    REASON_DESTROY: 0x1,
    REASON_RELEASE: 0x2,
    REASON_MATERIAL: 0x8,
    REASON_SUMMON: 0x10,
    REASON_BATTLE: 0x20,
    REASON_RULE: 0x400,
    REASON_SPSUMMON: 0x800,
    REASON_DISCARD: 0x4000,
    REASON_RETURN: 0x20000,
    REASON_FUSION: 0x40000,
    REASON_SYNCHRO: 0x80000,
    REASON_RITUAL: 0x100000,
    REASON_XYZ: 0x200000,
    REASON_LINK: 0x400000,
    REASON_REPLACE: 0x1000000,
    RESET_EVENT: 0x1000,
    RESET_PHASE: 0x4000,
    RESET_CHAIN: 0x8000,
    RESET_SELF_TURN: 0x10000000,
    RESET_OPPO_TURN: 0x20000000,
    RESETS_STANDARD: 0x2000,
    EFFECT_COUNT_CODE_OATH: 0x1,
    EFFECT_COUNT_CODE_DUEL: 0x2,
    EFFECT_COUNT_CODE_SINGLE: 0x4,
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
