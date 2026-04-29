import fengari from "fengari";
import { pushGroupTable } from "./lua-group-api.js";
import { readCardUid, readGroupUids } from "./lua-api-utils.js";
import type { PlayerId } from "./duel-types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelOperationApiHostState {
  operationInfos: LuaDuelOperationInfo[];
}

export interface LuaDuelOperationInfo {
  chainIndex: number;
  category: number;
  targetUids: string[];
  count: number;
  player: PlayerId;
  parameter: number;
}

export function installDuelOperationApi(L: unknown, hostState: LuaDuelOperationApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const info: LuaDuelOperationInfo = {
      chainIndex: lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0,
      category: lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0,
      targetUids: readCardOrGroupUids(state, 3),
      count: lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0,
      player: readOptionalPlayer(state, 5) ?? 0,
      parameter: lua.lua_isnumber(state, 6) ? lua.lua_tointeger(state, 6) : 0,
    };
    const existingIndex = hostState.operationInfos.findIndex((candidate) => candidate.chainIndex === info.chainIndex && candidate.category === info.category);
    if (existingIndex >= 0) hostState.operationInfos[existingIndex] = info;
    else hostState.operationInfos.push(info);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const chainIndex = lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0;
    const category = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const info = findOperationInfo(hostState.operationInfos, chainIndex, category);
    if (!info) {
      lua.lua_pushboolean(state, false);
      return 1;
    }
    lua.lua_pushboolean(state, true);
    lua.lua_pushinteger(state, info.category);
    pushGroupTable(state, info.targetUids);
    lua.lua_pushinteger(state, info.count);
    lua.lua_pushinteger(state, info.player);
    lua.lua_pushinteger(state, info.parameter);
    return 6;
  });
  lua.lua_setfield(L, -2, to_luastring("GetOperationInfo"));
}

function findOperationInfo(operationInfos: LuaDuelOperationInfo[], chainIndex: number, category: number): LuaDuelOperationInfo | undefined {
  for (let index = operationInfos.length - 1; index >= 0; index -= 1) {
    const candidate = operationInfos[index];
    if (!candidate) continue;
    if (candidate.chainIndex === chainIndex && candidate.category === category) return candidate;
  }
  return undefined;
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function readOptionalPlayer(L: unknown, index: number): PlayerId | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const value = lua.lua_tointeger(L, index);
  if (value !== 0 && value !== 1) return undefined;
  return value;
}
