import fengari from "fengari";
import { pushDuelLog } from "#duel/card-state.js";
import { readCardUid, readGroupUids } from "#lua/api-utils.js";
import { cardTypeFlags } from "#lua/card-stat-api.js";
import type { DuelSession } from "#duel/types.js";
import type { LuaPromptDecision } from "#lua/host-types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelPromptApiHostState {
  messages: string[];
  promptDecisions?: LuaPromptDecision[];
  nextPromptId?: number;
  promptBehavior?: "default" | "yield";
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
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectOption(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("SelectOption"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectYesNo(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("SelectYesNo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAskEveryone(state));
  lua.lua_setfield(L, -2, to_luastring("AskEveryone"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAskAny(state));
  lua.lua_setfield(L, -2, to_luastring("AskAny"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectEffectYesNo(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("SelectEffectYesNo"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectEffect(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("SelectEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectCardsFromCodes(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("SelectCardsFromCodes"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceNumber(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("AnnounceNumber"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceNumberRange(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("AnnounceNumberRange"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceCard(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("AnnounceCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceType(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("AnnounceType"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceMaskChoice(state, hostState, "AnnounceRace", raceAll, 0x2000000));
  lua.lua_setfield(L, -2, to_luastring("AnnounceRace"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceMaskChoice(state, hostState, "AnnounceAttribute", attributeAll, 0x40));
  lua.lua_setfield(L, -2, to_luastring("AnnounceAttribute"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceAnotherAttribute(state, session));
  lua.lua_setfield(L, -2, to_luastring("AnnounceAnotherAttribute"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceAnotherRace(state, session));
  lua.lua_setfield(L, -2, to_luastring("AnnounceAnotherRace"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAnnounceLevel(state, hostState));
  lua.lua_setfield(L, -2, to_luastring("AnnounceLevel"));
}

function pushSelectOption(L: unknown, hostState: LuaDuelPromptApiHostState): number {
  const top = lua.lua_gettop(L);
  const player = readPromptPlayer(L, 1);
  if (top < 2 || (top === 2 && lua.lua_isboolean(L, 2))) {
    const decision: LuaPromptDecision = { id: nextLuaPromptId(hostState), api: "SelectOption", ...(player === undefined ? {} : { player }), options: [], descriptions: [], returned: -1 };
    hostState.promptDecisions?.push(decision);
    if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
    lua.lua_pushinteger(L, -1);
    return 1;
  }
  const hasLeadingBoolean = lua.lua_isboolean(L, 2);
  const returned = hasLeadingBoolean ? 1 : 0;
  const descriptions = readSelectOptionValues(L, 2);
  const options = descriptions.map((_, index) => index + (hasLeadingBoolean ? 1 : 0));
  const decision: LuaPromptDecision = { id: nextLuaPromptId(hostState), api: "SelectOption", ...(player === undefined ? {} : { player }), options, descriptions, returned };
  hostState.promptDecisions?.push(decision);
  if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
  lua.lua_pushinteger(L, returned);
  return 1;
}

function pushSelectYesNo(L: unknown, hostState: LuaDuelPromptApiHostState): number {
  const player = readPromptPlayer(L, 1);
  const decision: LuaPromptDecision = {
    id: nextLuaPromptId(hostState),
    api: "SelectYesNo",
    ...(player === undefined ? {} : { player }),
    ...(lua.lua_isnumber(L, 2) ? { description: lua.lua_tointeger(L, 2) } : {}),
    returned: true,
  };
  hostState.promptDecisions?.push(decision);
  if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
  lua.lua_pushboolean(L, true);
  return 1;
}

function nextLuaPromptId(hostState: LuaDuelPromptApiHostState): string {
  const id = hostState.nextPromptId ?? 1;
  hostState.nextPromptId = id + 1;
  return `lua-prompt-${id}`;
}

function readPromptPlayer(L: unknown, index: number): 0 | 1 | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const player = lua.lua_tointeger(L, index);
  return player === 0 || player === 1 ? player : undefined;
}

function readSelectOptionValues(L: unknown, startIndex: number): number[] {
  const options: number[] = [];
  for (let index = startIndex; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) options.push(lua.lua_tointeger(L, index));
  }
  return options;
}

function pushHintSelection(L: unknown, session: DuelSession): number {
  const uids = readCardOrGroupUids(L, 1);
  const description = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const codes = uids.map((uid) => session.state.cards.find((card) => card.uid === uid)?.code).filter((code): code is string => Boolean(code));
  const detail = `${codes.length} selected${codes.length > 0 ? `: ${codes.join(",")}` : ""}${description === undefined ? "" : ` (${description})`}`;
  pushDuelLog(session.state, "hintSelection", session.state.turnPlayer, undefined, detail);
  return 0;
}

function pushSelectEffectYesNo(L: unknown, hostState: LuaDuelPromptApiHostState): number {
  const player = readPromptPlayer(L, 1);
  const description = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const decision: LuaPromptDecision = {
    id: nextLuaPromptId(hostState),
    api: "SelectEffectYesNo",
    ...(player === undefined ? {} : { player }),
    ...(description === undefined ? {} : { description }),
    returned: true,
  };
  hostState.promptDecisions?.push(decision);
  if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
  lua.lua_pushboolean(L, true);
  return 1;
}

function pushSelectEffect(L: unknown, hostState: LuaDuelPromptApiHostState): number {
  const top = lua.lua_gettop(L);
  const player = readPromptPlayer(L, 1);
  const choices = readSelectEffectChoices(L, top);
  const enabledChoices = choices.filter((choice) => choice.enabled);
  const firstEnabled = choices.find((choice) => choice.enabled);
  if (!firstEnabled) {
    lua.lua_pushnil(L);
    return 1;
  }
  const decision: LuaPromptDecision = {
    id: nextLuaPromptId(hostState),
    api: "SelectEffect",
    ...(player === undefined ? {} : { player }),
    options: enabledChoices.map((choice) => choice.option),
    descriptions: enabledChoices.map((choice) => choice.description),
    returned: firstEnabled.option,
  };
  hostState.promptDecisions?.push(decision);
  if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
  lua.lua_pushinteger(L, firstEnabled.option);
  return 1;
}

function readSelectEffectChoices(L: unknown, top: number): Array<{ option: number; description: number; enabled: boolean }> {
  const choices: Array<{ option: number; description: number; enabled: boolean }> = [];
  for (let index = 2; index <= top; index += 1) {
    if (!lua.lua_istable(L, index)) continue;
    lua.lua_rawgeti(L, index, 1);
    const enabled = lua.lua_toboolean(L, -1);
    lua.lua_pop(L, 1);
    lua.lua_rawgeti(L, index, 2);
    const description = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : 0;
    lua.lua_pop(L, 1);
    choices.push({ option: index - 1, description, enabled });
  }
  return choices;
}

function pushAnnounceNumber(L: unknown, hostState: LuaDuelPromptApiHostState): number {
  const player = readPromptPlayer(L, 1);
  const options = readAnnouncementValues(L, 2);
  const returned = options[0] ?? 0;
  if (options.length === 0) {
    lua.lua_pushinteger(L, returned);
    return 1;
  }
  const decision: LuaPromptDecision = { id: nextLuaPromptId(hostState), api: "AnnounceNumber", ...(player === undefined ? {} : { player }), options, descriptions: [...options], returned };
  hostState.promptDecisions?.push(decision);
  if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
  lua.lua_pushinteger(L, returned);
  return 1;
}

function pushAskEveryone(L: unknown): number {
  lua.lua_pushboolean(L, true);
  return 1;
}

function pushAskAny(L: unknown): number {
  lua.lua_pushboolean(L, true);
  return 1;
}

function pushSelectCardsFromCodes(L: unknown, hostState: LuaDuelPromptApiHostState): number {
  const player = readPromptPlayer(L, 1);
  const min = lua.lua_isnumber(L, 2) ? Math.max(0, lua.lua_tointeger(L, 2)) : 1;
  const max = lua.lua_isnumber(L, 3) ? Math.max(0, lua.lua_tointeger(L, 3)) : min;
  const includeIndexes = lua.lua_toboolean(L, 5);
  const choices = readCodeChoices(L, 6);
  const requestedCount = max === 0 ? choices.length : Math.max(min, max);
  const count = Math.min(requestedCount, choices.length);
  if (count === 1 && choices.length > 0) {
    const options = includeIndexes ? choices.map((choice) => choice.index) : choices.map((choice) => choice.code);
    const descriptions = choices.map((choice) => choice.code);
    const returned = options[0] ?? 0;
    const decision: LuaPromptDecision = {
      id: nextLuaPromptId(hostState),
      api: "SelectCardsFromCodes",
      ...(player === undefined ? {} : { player }),
      options,
      descriptions,
      returned,
      ...(includeIndexes ? { returnKind: "codeIndexTable" } : {}),
    };
    hostState.promptDecisions?.push(decision);
    if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
  }
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

function pushAnnounceType(L: unknown, hostState: LuaDuelPromptApiHostState): number {
  const player = readPromptPlayer(L, 1);
  const options = readAnnouncementValues(L, 2);
  const returned = options[0] ?? 0;
  if (options.length > 0) {
    const decision: LuaPromptDecision = { id: nextLuaPromptId(hostState), api: "AnnounceType", ...(player === undefined ? {} : { player }), options, descriptions: [...options], returned };
    hostState.promptDecisions?.push(decision);
    if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
  }
  lua.lua_pushinteger(L, returned);
  return 1;
}

function pushAnnounceCard(L: unknown, session: DuelSession, hostState: LuaDuelPromptApiHostState): number {
  const player = readPromptPlayer(L, 1);
  const options = announceCardCodeOptions(L, session);
  const code = options[0] ?? 0;
  if (options.length > 0) {
    const decision: LuaPromptDecision = { id: nextLuaPromptId(hostState), api: "AnnounceCard", ...(player === undefined ? {} : { player }), options, descriptions: [...options], returned: code };
    hostState.promptDecisions?.push(decision);
    if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
  }
  lua.lua_pushinteger(L, code ?? 0);
  return 1;
}

function announceCardCodeOptions(L: unknown, session: DuelSession): number[] {
  const values = readAnnouncementValues(L, 2).filter((value) => Number.isSafeInteger(value) && value >= 0);
  if (values.length === 0) return knownCardCodes(session);
  const explicitCodes = values.filter((value) => session.state.cards.some((card) => Number(card.code) === value));
  if (explicitCodes.length > 0) return [...new Set(explicitCodes)];
  const typeMask = values.find((value) => value > 0 && value <= 0xff && session.state.cards.some((card) => (cardTypeFlags(card) & value) !== 0));
  if (typeMask !== undefined) return knownCardCodes(session, typeMask);
  const declaredCode = values.find((value) => value > 0xff);
  if (declaredCode !== undefined) return [declaredCode];
  return knownCardCodes(session, values[0]);
}

function knownCardCodes(session: DuelSession, typeMask?: number): number[] {
  return [
    ...new Set(
      [...session.state.cards]
        .sort((left, right) => Number(left.code) - Number(right.code))
        .filter((candidate) => typeMask === undefined || typeMask === 0 || (cardTypeFlags(candidate) & typeMask) !== 0)
        .map((card) => Number(card.code))
        .filter((code) => Number.isSafeInteger(code) && code > 0),
    ),
  ];
}

function readAnnouncementValues(L: unknown, startIndex: number): number[] {
  const values: number[] = [];
  for (let index = startIndex; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) values.push(lua.lua_tointeger(L, index));
    else if (lua.lua_istable(L, index)) readAnnouncementTableValues(L, index, values);
  }
  return values;
}

function readAnnouncementTableValues(L: unknown, tableIndex: number, values: number[]): void {
  const count = lua.lua_rawlen(L, tableIndex);
  for (let luaIndex = 1; luaIndex <= count; luaIndex += 1) {
    lua.lua_rawgeti(L, tableIndex, luaIndex);
    if (lua.lua_isnumber(L, -1)) values.push(lua.lua_tointeger(L, -1));
    lua.lua_pop(L, 1);
  }
}

function pushAnnounceMaskChoice(L: unknown, hostState: LuaDuelPromptApiHostState, api: "AnnounceRace" | "AnnounceAttribute", fallbackMask: number, maxBit: number): number {
  const player = readPromptPlayer(L, 1);
  const mask = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : fallbackMask;
  const options = singleBitsThrough(mask, maxBit);
  const fallbackOptions = singleBitsThrough(fallbackMask, maxBit);
  const promptOptions = options.length > 0 ? options : fallbackOptions;
  const returned = promptOptions[0] ?? 0;
  if (promptOptions.length === 0) {
    lua.lua_pushinteger(L, returned);
    return 1;
  }
  const decision: LuaPromptDecision = { id: nextLuaPromptId(hostState), api, ...(player === undefined ? {} : { player }), options: promptOptions, descriptions: [...promptOptions], returned };
  hostState.promptDecisions?.push(decision);
  if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
  lua.lua_pushinteger(L, returned);
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

function singleBitsThrough(mask: number, maxBit: number): number[] {
  const bits: number[] = [];
  for (let bit = 1; bit <= maxBit; bit <<= 1) {
    if ((mask & bit) !== 0) bits.push(bit);
  }
  return bits;
}

function pushAnnounceNumberRange(L: unknown, hostState: LuaDuelPromptApiHostState): number {
  const player = readPromptPlayer(L, 1);
  const options = readAnnounceNumberRangeOptions(L);
  const returned = options[0] ?? 0;
  if (options.length === 0) {
    lua.lua_pushinteger(L, returned);
    return 1;
  }
  const decision: LuaPromptDecision = { id: nextLuaPromptId(hostState), api: "AnnounceNumberRange", ...(player === undefined ? {} : { player }), options, descriptions: [...options], returned };
  hostState.promptDecisions?.push(decision);
  if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
  lua.lua_pushinteger(L, returned);
  return 1;
}

function readAnnounceNumberRangeOptions(L: unknown): number[] {
  const min = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const max = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : min;
  const exceptions = new Set<number>();
  for (let index = 4; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) exceptions.add(lua.lua_tointeger(L, index));
  }
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const options: number[] = [];
  for (let value = low; value <= high; value += 1) {
    if (!exceptions.has(value)) options.push(value);
  }
  return options.length > 0 ? options : [low];
}

function pushAnnounceLevel(L: unknown, hostState: LuaDuelPromptApiHostState): number {
  const player = readPromptPlayer(L, 1);
  const options = readAnnounceLevelOptions(L);
  const returned = options[0] ?? 1;
  if (options.length === 0) {
    lua.lua_pushinteger(L, returned);
    return 1;
  }
  const decision: LuaPromptDecision = { id: nextLuaPromptId(hostState), api: "AnnounceLevel", ...(player === undefined ? {} : { player }), options, descriptions: [...options], returned };
  hostState.promptDecisions?.push(decision);
  if (hostState.promptBehavior === "yield") return lua.lua_yield(L, 0);
  lua.lua_pushinteger(L, returned);
  return 1;
}

function readAnnounceLevelOptions(L: unknown): number[] {
  const min = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 1;
  const max = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 12;
  const exceptions = new Set<number>();
  for (let index = 4; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) exceptions.add(lua.lua_tointeger(L, index));
  }
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const options: number[] = [];
  for (let level = low; level <= high; level += 1) {
    if (!exceptions.has(level)) options.push(level);
  }
  return options.length > 0 ? options : [low];
}

const attributeAll = 0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40;
const raceAll = 0x3ffffff;
