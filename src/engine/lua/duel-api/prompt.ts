import fengari from "fengari";
import { pushDuelLog } from "#duel/card-state.js";
import { readCardUid, readGroupUids } from "#lua/api-utils.js";
import type { DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelPromptApiHostState {
  messages: string[];
}

export function installDuelPromptApi(L: unknown, session: DuelSession, hostState: LuaDuelPromptApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const message = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : "";
    hostState.messages.push(message);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("DebugMessage"));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("Hint"));
  lua.lua_pushcfunction(L, (state: unknown) => pushHintSelection(state, session));
  lua.lua_setfield(L, -2, to_luastring("HintSelection"));
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
  lua.lua_pushcfunction(L, (state: unknown) => pushAskEveryone(state));
  lua.lua_setfield(L, -2, to_luastring("AskEveryone"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, true);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectEffectYesNo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectEffect(state));
  lua.lua_setfield(L, -2, to_luastring("SelectEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectCardsFromCodes(state));
  lua.lua_setfield(L, -2, to_luastring("SelectCardsFromCodes"));
  pushAnnouncementHelper(L, "AnnounceNumber");
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceNumberRange(state));
  lua.lua_setfield(L, -2, to_luastring("AnnounceNumberRange"));
  pushAnnouncementHelper(L, "AnnounceCard");
  pushAnnouncementHelper(L, "AnnounceType");
  pushAnnouncementHelper(L, "AnnounceRace");
  pushAnnouncementHelper(L, "AnnounceAttribute");
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceAnotherAttribute(state, session));
  lua.lua_setfield(L, -2, to_luastring("AnnounceAnotherAttribute"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceAnotherRace(state, session));
  lua.lua_setfield(L, -2, to_luastring("AnnounceAnotherRace"));
  pushAnnouncementHelper(L, "AnnounceLevel");
}

function pushHintSelection(L: unknown, session: DuelSession): number {
  const uids = readCardOrGroupUids(L, 1);
  const description = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const codes = uids.map((uid) => session.state.cards.find((card) => card.uid === uid)?.code).filter((code): code is string => Boolean(code));
  const detail = `${codes.length} selected${codes.length > 0 ? `: ${codes.join(",")}` : ""}${description === undefined ? "" : ` (${description})`}`;
  pushDuelLog(session.state, "hintSelection", session.state.turnPlayer, undefined, detail);
  return 0;
}

function pushSelectEffect(L: unknown): number {
  const top = lua.lua_gettop(L);
  for (let index = 2; index <= top; index += 1) {
    if (!lua.lua_istable(L, index)) continue;
    lua.lua_rawgeti(L, index, 1);
    const enabled = lua.lua_toboolean(L, -1);
    lua.lua_pop(L, 1);
    if (enabled) {
      lua.lua_pushinteger(L, index - 1);
      return 1;
    }
  }
  lua.lua_pushnil(L);
  return 1;
}

function pushAskEveryone(L: unknown): number {
  lua.lua_pushboolean(L, true);
  return 1;
}

function pushSelectCardsFromCodes(L: unknown): number {
  const min = lua.lua_isnumber(L, 2) ? Math.max(0, lua.lua_tointeger(L, 2)) : 1;
  const max = lua.lua_isnumber(L, 3) ? Math.max(0, lua.lua_tointeger(L, 3)) : min;
  const includeIndexes = lua.lua_toboolean(L, 5);
  const choices = readCodeChoices(L, 6);
  const requestedCount = max === 0 ? choices.length : Math.max(min, max);
  const count = Math.min(requestedCount, choices.length);
  for (const choice of choices.slice(0, count)) {
    if (includeIndexes) pushCodeIndexTable(L, choice.code, choice.index);
    else lua.lua_pushinteger(L, choice.code);
  }
  return count;
}

function readCodeChoices(L: unknown, startIndex: number): Array<{ code: number; index: number }> {
  const choices: Array<{ code: number; index: number }> = [];
  for (let index = startIndex; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) choices.push({ code: lua.lua_tointeger(L, index), index: choices.length + 1 });
    else if (lua.lua_istable(L, index)) readCodeTableChoices(L, index, choices);
  }
  return choices;
}

function readCodeTableChoices(L: unknown, tableIndex: number, choices: Array<{ code: number; index: number }>): void {
  const count = lua.lua_rawlen(L, tableIndex);
  for (let luaIndex = 1; luaIndex <= count; luaIndex += 1) {
    lua.lua_rawgeti(L, tableIndex, luaIndex);
    if (lua.lua_isnumber(L, -1)) choices.push({ code: lua.lua_tointeger(L, -1), index: choices.length + 1 });
    lua.lua_pop(L, 1);
  }
}

function pushCodeIndexTable(L: unknown, code: number, index: number): void {
  lua.lua_newtable(L);
  lua.lua_pushinteger(L, code);
  lua.lua_rawseti(L, -2, 1);
  lua.lua_pushinteger(L, index);
  lua.lua_rawseti(L, -2, 2);
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
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

function pushAnnounceAnotherAttribute(L: unknown, session: DuelSession): number {
  const currentMask = readCardOrGroupUids(L, 1).reduce((mask, uid) => {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    return mask | (card?.data.attribute ?? 0);
  }, 0);
  lua.lua_pushinteger(L, firstDifferentBit(currentMask, attributeAll, 0x40));
  return 1;
}

function pushAnnounceAnotherRace(L: unknown, session: DuelSession): number {
  const currentMask = readCardOrGroupUids(L, 1).reduce((mask, uid) => {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    return mask | (card?.data.race ?? 0);
  }, 0);
  lua.lua_pushinteger(L, firstDifferentBit(currentMask, raceAll, 0x2000000));
  return 1;
}

function isSingleBit(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function firstDifferentBit(currentMask: number, allMask: number, maxBit: number): number {
  const allowedMask = currentMask > 0 && isSingleBit(currentMask) ? allMask & ~currentMask : allMask;
  return firstSingleBitThrough(allowedMask, maxBit) ?? firstSingleBitThrough(allMask, maxBit) ?? 0;
}

function firstSingleBitThrough(mask: number, maxBit: number): number | undefined {
  for (let bit = 1; bit <= maxBit; bit <<= 1) {
    if ((mask & bit) !== 0) return bit;
  }
  return undefined;
}

function pushAnnounceNumberRange(L: unknown): number {
  const min = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const max = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : min;
  const exceptions = new Set<number>();
  for (let index = 4; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) exceptions.add(lua.lua_tointeger(L, index));
  }
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  for (let value = low; value <= high; value += 1) {
    if (!exceptions.has(value)) {
      lua.lua_pushinteger(L, value);
      return 1;
    }
  }
  lua.lua_pushinteger(L, low);
  return 1;
}

const attributeAll = 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40;
const raceAll = 0x3ffffff;
