import fengari from "fengari";
import { pushCardTable } from "./lua-card-api.js";
import { installDuelActivityApi } from "./lua-duel-activity-api.js";
import { installDuelChainApi } from "./lua-duel-chain-api.js";
import { installDuelDeckApi } from "./lua-duel-deck-api.js";
import { installDuelFlagApi } from "./lua-duel-flag-api.js";
import { installDuelLpApi } from "./lua-duel-lp-api.js";
import { installDuelMoveApi } from "./lua-duel-move-api.js";
import { installDuelOperationApi } from "./lua-duel-operation-api.js";
import { installDuelPlayerApi } from "./lua-duel-player-api.js";
import { installDuelQueryApi } from "./lua-duel-query-api.js";
import { installDuelReleaseApi } from "./lua-duel-release-api.js";
import { installDuelSummonApi } from "./lua-duel-summon-api.js";
import { installDuelTurnApi } from "./lua-duel-turn-api.js";
import type { LuaDuelOperationInfo } from "./lua-duel-operation-api.js";
import type { DuelSession } from "./duel-types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelApiHostState {
  messages: string[];
  activeTargetUids: string[] | undefined;
  operationInfos: LuaDuelOperationInfo[];
  operatedUids: string[];
  pushEffectTable: (state: unknown, id: number) => void;
}

export function installDuelApi(L: unknown, session: DuelSession, hostState: LuaDuelApiHostState): void {
  lua.lua_newtable(L);
  installDuelTurnApi(L, session);
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
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstAnnouncementValue(state, 0));
  lua.lua_setfield(L, -2, to_luastring("AnnounceNumber"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstAnnouncementValue(state, 0));
  lua.lua_setfield(L, -2, to_luastring("AnnounceCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstAnnouncementValue(state, 0));
  lua.lua_setfield(L, -2, to_luastring("AnnounceType"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstAnnouncementValue(state, 0));
  lua.lua_setfield(L, -2, to_luastring("AnnounceRace"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFirstAnnouncementValue(state, 0));
  lua.lua_setfield(L, -2, to_luastring("AnnounceAttribute"));
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
  installDuelChainApi(L, session, hostState);
  installDuelActivityApi(L, session);
  installDuelLpApi(L, session);
  installDuelDeckApi(L, session, hostState);
  installDuelPlayerApi(L, session);
  installDuelMoveApi(L, session, hostState);
  installDuelSummonApi(L, session, hostState);
  installDuelQueryApi(L, session, hostState);
  installDuelReleaseApi(L, session);
  installDuelOperationApi(L, hostState);
  installDuelFlagApi(L, session);
  lua.lua_setglobal(L, to_luastring("Duel"));
}

function pushFirstAnnouncementValue(L: unknown, fallback: number): number {
  const value = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : fallback;
  lua.lua_pushinteger(L, value);
  return 1;
}
