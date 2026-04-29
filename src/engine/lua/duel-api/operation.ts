import fengari from "fengari";
import { pushGroupTable } from "#lua/group-api.js";
import { readCardUid, readGroupUids } from "#lua/api-utils.js";
import type { PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelOperationApiHostState {
  operationInfos: LuaDuelOperationInfo[];
  possibleOperationInfos: LuaDuelOperationInfo[];
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
  lua.lua_pushcfunction(L, (state: unknown) => pushSetOperationInfo(state, hostState.operationInfos));
  lua.lua_setfield(L, -2, to_luastring("SetOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetOperationInfo(state, hostState.operationInfos));
  lua.lua_setfield(L, -2, to_luastring("GetOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSetOperationInfo(state, hostState.possibleOperationInfos));
  lua.lua_setfield(L, -2, to_luastring("SetPossibleOperationInfo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetOperationInfo(state, hostState.possibleOperationInfos));
  lua.lua_setfield(L, -2, to_luastring("GetPossibleOperationInfo"));
}

function pushSetOperationInfo(L: unknown, operationInfos: LuaDuelOperationInfo[]): number {
  const info: LuaDuelOperationInfo = {
    chainIndex: lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0,
    category: lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0,
    targetUids: readCardOrGroupUids(L, 3),
    count: lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 0,
    player: readOptionalPlayer(L, 5) ?? 0,
    parameter: lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 0,
  };
  const existingIndex = operationInfos.findIndex((candidate) => candidate.chainIndex === info.chainIndex && candidate.category === info.category);
  if (existingIndex >= 0) operationInfos[existingIndex] = info;
  else operationInfos.push(info);
  return 0;
}

function pushGetOperationInfo(L: unknown, operationInfos: LuaDuelOperationInfo[]): number {
  const chainIndex = lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : 0;
  const category = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const info = findOperationInfo(operationInfos, chainIndex, category);
  if (!info) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  lua.lua_pushboolean(L, true);
  lua.lua_pushinteger(L, info.category);
  pushGroupTable(L, info.targetUids);
  lua.lua_pushinteger(L, info.count);
  lua.lua_pushinteger(L, info.player);
  lua.lua_pushinteger(L, info.parameter);
  return 6;
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
