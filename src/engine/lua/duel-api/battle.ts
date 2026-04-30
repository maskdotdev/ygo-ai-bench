import fengari from "fengari";
import { negateDuelAttack } from "#duel/core.js";
import { pushCardTable } from "#lua/card-api.js";
import type { DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelBattleApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const attackerUid = session.state.currentAttack?.attackerUid;
    if (!attackerUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, attackerUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetAttacker"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const targetUid = session.state.currentAttack?.targetUid;
    if (!targetUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, targetUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetAttackTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, negateDuelAttack(session.state));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("NegateAttack"));
}
