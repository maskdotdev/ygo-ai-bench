import fengari from "fengari";
import { drawDuelCards, sendDuelCardToGraveyard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { pushCardTable } from "#lua/card-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import { locationsFromMask, readCardUid, readGroupUids, readOptionalFunctionRef, releaseOptionalFunctionRef } from "#lua/api-utils.js";
import { shuffle } from "#engine/rng.js";
import type { DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

type LuaFilterArgs = { start: number; count: number };

export interface LuaDuelDeckApiHostState {
  messages: string[];
  operatedUids: string[];
}

export function installDuelDeckApi(L: unknown, session: DuelSession, hostState: LuaDuelDeckApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    lua.lua_pushboolean(state, topDeckUids(session, player, count).length >= count);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanDraw"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    lua.lua_pushboolean(state, topDeckUids(session, player, count).length >= count);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanDiscardDeck"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    lua.lua_pushboolean(state, topDeckUids(session, player, count).length >= count);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanDiscardDeckAsCost"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    lua.lua_pushboolean(state, matchingCardUids(session, player, 0x02).length >= count);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanDiscardHand"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1;
    const drawUids = topDeckUids(session, player, count);
    const drawn = drawDuelCards(session.state, player, count, "Lua draw");
    setOperatedUids(hostState, drawUids.slice(0, drawn));
    lua.lua_pushinteger(state, drawn);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Draw"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    const reason = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : duelReason.effect;
    const discarded = discardDeckCards(session, player, count, reason);
    setOperatedUids(hostState, discarded);
    lua.lua_pushinteger(state, discarded.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("DiscardDeck"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const discarded = discardHandCards(session, state);
    setOperatedUids(hostState, discarded);
    lua.lua_pushinteger(state, discarded.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("DiscardHand"));
  installDeckQueryHelpers(L, session, hostState);
}

function installDeckQueryHelpers(L: unknown, session: DuelSession, hostState: LuaDuelDeckApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    pushGroupTable(state, topDeckUids(session, player, count));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetDecktopGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const confirmed = readCardOrGroupUids(state, 2)
      .map((uid) => session.state.cards.find((card) => card.uid === uid)?.code)
      .filter((code): code is string => Boolean(code));
    hostState.messages.push(`confirmed ${player}: ${confirmed.join(",")}`);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ConfirmCards"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    const confirmed = topDeckUids(session, player, count)
      .map((uid) => session.state.cards.find((card) => card.uid === uid)?.code)
      .filter((code): code is string => Boolean(code));
    hostState.messages.push(`confirmed decktop ${player}: ${confirmed.join(",")}`);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ConfirmDecktop"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    shuffleDeck(session, player);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ShuffleDeck"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    shuffleHand(session, player);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ShuffleHand"));
}

function discardDeckCards(session: DuelSession, player: PlayerId, count: number, reason: number): string[] {
  const discarded: string[] = [];
  for (const uid of topDeckUids(session, player, count)) {
    try {
      sendDuelCardToGraveyard(session.state, uid, player, reason);
      discarded.push(uid);
    } catch {
      // EDOPro-style helpers report moved cards; illegal moves simply fail.
    }
  }
  return discarded;
}

function discardHandCards(session: DuelSession, L: unknown): string[] {
  const filterRef = readOptionalFunctionRef(L, 2);
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const min = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1);
  const max = Math.max(min, lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : min);
  const reason = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : duelReason.effect;
  const selected = matchingCardUidsWithFilter(L, session, filterRef, player, 0x02, 0, undefined, readFilterArgs(L, 6)).slice(0, max);
  releaseOptionalFunctionRef(L, filterRef);
  if (selected.length < min) return [];
  const discarded: string[] = [];
  for (const uid of selected) {
    try {
      sendDuelCardToGraveyard(session.state, uid, player, reason);
      discarded.push(uid);
    } catch {
      // EDOPro-style helpers report moved cards; illegal moves simply fail.
    }
  }
  return discarded;
}

function topDeckUids(session: DuelSession, player: PlayerId, count: number): string[] {
  return matchingCardUids(session, player, 0x01).slice(0, count);
}

function shuffleDeck(session: DuelSession, player: PlayerId): void {
  const deckCards = session.state.cards.filter((card) => card.controller === player && card.location === "deck").sort((a, b) => a.sequence - b.sequence);
  const shuffled = shuffle(deckCards, `${session.state.seed}:lua-shuffle:${player}:${session.state.log.length}`);
  for (const [sequence, card] of shuffled.entries()) card.sequence = sequence;
}

function shuffleHand(session: DuelSession, player: PlayerId): void {
  const handCards = session.state.cards.filter((card) => card.controller === player && card.location === "hand").sort((a, b) => a.sequence - b.sequence);
  const shuffled = shuffle(handCards, `${session.state.seed}:lua-shuffle-hand:${player}:${session.state.log.length}`);
  for (const [sequence, card] of shuffled.entries()) card.sequence = sequence;
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function matchingCardUidsWithFilter(
  L: unknown,
  session: DuelSession,
  filterRef: number | undefined,
  player: PlayerId,
  selfMask: number,
  opponentMask: number,
  excluded: string | undefined,
  args: LuaFilterArgs,
): string[] {
  return fieldGroupUids(session, player, selfMask, opponentMask).filter((uid) => uid !== excluded && cardMatchesFilter(L, uid, filterRef, args));
}

function cardMatchesFilter(L: unknown, uid: string, filterRef: number | undefined, args: LuaFilterArgs): boolean {
  if (filterRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushCardTable(L, uid);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 1 + args.count, 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function readFilterArgs(L: unknown, start: number): LuaFilterArgs {
  const top = lua.lua_gettop(L);
  return { start, count: Math.max(0, top - start + 1) };
}

function fieldGroupUids(session: DuelSession, player: PlayerId, selfMask: number, opponentMask: number): string[] {
  return [
    ...matchingCardUids(session, player, selfMask),
    ...matchingCardUids(session, otherPlayer(player), opponentMask),
  ];
}

function matchingCardUids(session: DuelSession, player: PlayerId, locationMask: number): string[] {
  const locations = locationsFromMask(locationMask);
  return session.state.cards
    .filter((card) => card.controller === player && locations.includes(card.location))
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid);
}

function setOperatedUids(hostState: LuaDuelDeckApiHostState, uids: string[]): void {
  hostState.operatedUids.splice(0, hostState.operatedUids.length, ...uids);
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
