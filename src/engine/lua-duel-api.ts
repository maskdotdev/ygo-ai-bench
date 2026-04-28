import fengari from "fengari";
import {
  banishDuelCard,
  changeDuelCardPosition,
  damageDuelPlayer,
  destroyDuelCard,
  fusionSummonDuelCard,
  linkSummonDuelCard,
  negateDuelChainLink,
  recoverDuelPlayer,
  ritualSummonDuelCard,
  sendDuelCardToGraveyard,
  setDuelPlayerLifePoints,
  specialSummonDuelCard,
  synchroSummonDuelCard,
  xyzSummonDuelCard,
} from "./duel-core.js";
import type { CardPosition, DuelLocation, DuelSession, PlayerId } from "./duel-types.js";

const { lua, lauxlib, to_luastring } = fengari;

export interface LuaDuelApiHostState {
  messages: string[];
  activeTargetUids: string[] | undefined;
}

export function installDuelApi(L: unknown, session: DuelSession, hostState: LuaDuelApiHostState): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.turnPlayer);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTurnPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushliteral(state, session.state.phase);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCurrentPhase"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const message = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : "";
    hostState.messages.push(message);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("DebugMessage"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.chain.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCurrentChain"));
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
    const target = lua.lua_isnumber(state, 1) ? session.state.chain[lua.lua_tointeger(state, 1) - 1] : session.state.chain[session.state.chain.length - 1];
    if (!target) {
      lua.lua_pushboolean(state, false);
      return 1;
    }
    const source = session.state.cards.find((candidate) => candidate.uid === target.sourceUid);
    lua.lua_pushboolean(state, negateDuelChainLink(session.state, target.id, source?.controller ?? session.state.turnPlayer, source?.name ?? "Lua effect"));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("NegateActivation"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushinteger(state, session.state.players[player].lifePoints);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLP"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    setDuelPlayerLifePoints(session.state, player, value);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetLP"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, damageDuelPlayer(session.state, player, value));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Damage"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, recoverDuelPlayer(session.state, player, value));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Recover"));
  installMoveHelpers(L, session);
  installSummonHelpers(L, session);
  installQueryHelpers(L, session, hostState);
  lua.lua_setglobal(L, to_luastring("Duel"));
}

function installMoveHelpers(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, moveCardOrGroup(session, state, sendDuelCardToGraveyard));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SendtoGrave"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, moveCardOrGroup(session, state, destroyDuelCard));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Destroy"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, moveCardOrGroup(session, state, banishDuelCard));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Remove"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids = readCardOrGroupUids(state, 1);
    const targetPlayer = lua.lua_isnumber(state, 5) ? normalizePlayer(lua.lua_tointeger(state, 5)) : undefined;
    let moved = 0;
    for (const uid of uids) {
      const card = session.state.cards.find((candidate) => candidate.uid === uid);
      if (!card) continue;
      try {
        specialSummonDuelCard(session.state, uid, targetPlayer ?? card.controller);
        moved += 1;
      } catch {
        // EDOPro-style helpers report the number of moved cards; illegal moves simply fail.
      }
    }
    lua.lua_pushinteger(state, moved);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SpecialSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids = readCardOrGroupUids(state, 1);
    const requestedPosition = lua.lua_isnumber(state, 2) ? positionFromMask(lua.lua_tointeger(state, 2)) : undefined;
    if (!requestedPosition) {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    let changed = 0;
    for (const uid of uids) {
      const card = session.state.cards.find((candidate) => candidate.uid === uid);
      if (!card) continue;
      try {
        changeDuelCardPosition(session.state, card.controller, uid, requestedPosition);
        changed += 1;
      } catch {
        // EDOPro-style helpers report the number of changed cards; illegal changes simply fail.
      }
    }
    lua.lua_pushinteger(state, changed);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ChangePosition"));
}

function installSummonHelpers(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, "FusionSummon"));
  lua.lua_setfield(L, -2, to_luastring("FusionSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, "SynchroSummon"));
  lua.lua_setfield(L, -2, to_luastring("SynchroSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, "XyzSummon"));
  lua.lua_setfield(L, -2, to_luastring("XyzSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, "LinkSummon"));
  lua.lua_setfield(L, -2, to_luastring("LinkSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, "RitualSummon"));
  lua.lua_setfield(L, -2, to_luastring("RitualSummon"));
}

function installQueryHelpers(L: unknown, session: DuelSession, hostState: LuaDuelApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 1);
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : session.state.turnPlayer);
    const selfMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const opponentMask = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const excluded = readCardUid(state, 5);
    const uids = matchingCardUidsWithFilter(state, session, filterRef, player, selfMask, opponentMask, excluded);
    releaseOptionalFunctionRef(state, filterRef);
    pushGroupTable(state, uids);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetMatchingGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 1);
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : session.state.turnPlayer);
    const selfMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const opponentMask = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const excluded = readCardUid(state, 5);
    const count = matchingCardUidsWithFilter(state, session, filterRef, player, selfMask, opponentMask, excluded).length;
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushinteger(state, count);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetMatchingGroupCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 1);
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : session.state.turnPlayer);
    const selfMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    const opponentMask = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : 0;
    const minimum = lua.lua_isnumber(state, 5) ? lua.lua_tointeger(state, 5) : 1;
    const excluded = readCardUid(state, 6);
    const count = matchingCardUidsWithFilter(state, session, filterRef, player, selfMask, opponentMask, excluded).length;
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, count >= minimum);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsExistingMatchingCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, availableLocationCount(session, player, locationMask));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLocationCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedMatchingGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectMatchingCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectedMatchingGroup(state, session, hostState.activeTargetUids));
  lua.lua_setfield(L, -2, to_luastring("SelectTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const target = hostState.activeTargetUids?.[0];
    if (!target) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, target);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFirstTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, hostState.activeTargetUids ?? []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetTargetCards"));
}

function moveCardOrGroup(session: DuelSession, L: unknown, mover: typeof sendDuelCardToGraveyard): number {
  let moved = 0;
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    try {
      mover(session.state, uid, card.controller);
      moved += 1;
    } catch {
      // EDOPro-style helpers report the number of moved cards; illegal moves simply fail.
    }
  }
  return moved;
}

function pushLuaSummonResult(L: unknown, session: DuelSession, summonType: "FusionSummon" | "SynchroSummon" | "XyzSummon" | "LinkSummon" | "RitualSummon"): number {
  const targetUid = readCardUid(L, 1);
  const materialUids = readCardOrGroupUids(L, 2);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (!target) {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  try {
    if (summonType === "FusionSummon") fusionSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else if (summonType === "SynchroSummon") synchroSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else if (summonType === "XyzSummon") xyzSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else if (summonType === "LinkSummon") linkSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else ritualSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    lua.lua_pushinteger(L, 1);
  } catch {
    lua.lua_pushinteger(L, 0);
  }
  return 1;
}

function pushCardTable(L: unknown, uid: string): void {
  lua.lua_newtable(L);
  lua.lua_pushliteral(L, uid);
  lua.lua_setfield(L, -2, to_luastring("__duel_uid"));
  for (const fieldName of [
    "RegisterEffect",
    "GetCode",
    "IsCode",
    "IsSetCard",
    "IsFaceup",
    "IsFacedown",
    "IsPosition",
    "IsAttackPos",
    "IsDefensePos",
    "IsLocation",
    "IsControler",
    "IsAbleToGrave",
    "IsAbleToHand",
    "IsAbleToDeck",
    "IsAbleToRemove",
    "IsAbleToExtra",
  ]) {
    copyGlobalFunctionToField(L, "Card", fieldName);
  }
}

function pushGroupTable(L: unknown, uids: string[]): void {
  lua.lua_newtable(L);
  lua.lua_newtable(L);
  for (const [index, uid] of uids.entries()) {
    lua.lua_pushliteral(L, uid);
    lua.lua_rawseti(L, -2, index + 1);
  }
  lua.lua_setfield(L, -2, to_luastring("__group_uids"));
  copyGlobalFunctionToField(L, "Group", "GetFirst");
  copyGlobalFunctionToField(L, "Group", "GetCount");
}

function copyGlobalFunctionToField(L: unknown, tableName: string, fieldName: string): void {
  lua.lua_getglobal(L, to_luastring(tableName));
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  lua.lua_setfield(L, -3, to_luastring(fieldName));
  lua.lua_pop(L, 1);
}

function readCardUid(L: unknown, index: number): string | undefined {
  if (!lua.lua_istable(L, index)) return undefined;
  return readTableStringField(L, index, "__duel_uid");
}

function readGroupUids(L: unknown, index: number): string[] {
  if (!lua.lua_istable(L, index)) return [];
  lua.lua_getfield(L, index, to_luastring("__group_uids"));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return [];
  }
  const count = lua.lua_rawlen(L, -1);
  const uids: string[] = [];
  for (let luaIndex = 1; luaIndex <= count; luaIndex += 1) {
    lua.lua_rawgeti(L, -1, luaIndex);
    const uid = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
    if (uid) uids.push(uid);
    lua.lua_pop(L, 1);
  }
  lua.lua_pop(L, 1);
  return uids;
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function readTableStringField(L: unknown, index: number, fieldName: string): string | undefined {
  lua.lua_getfield(L, index, to_luastring(fieldName));
  const value = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function readOptionalFunctionRef(L: unknown, index: number): number | undefined {
  if (!lua.lua_isfunction(L, index)) return undefined;
  lua.lua_pushvalue(L, index);
  return lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
}

function releaseOptionalFunctionRef(L: unknown, ref: number | undefined): void {
  if (ref !== undefined) lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, ref);
}

function cardMatchesFilter(L: unknown, uid: string, filterRef: number | undefined): boolean {
  if (filterRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushCardTable(L, uid);
  const status = lua.lua_pcall(L, 1, 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function pushSelectedMatchingGroup(L: unknown, session: DuelSession, targetUids?: string[]): number {
  const filterRef = readOptionalFunctionRef(L, 2);
  const player = normalizePlayer(lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : session.state.turnPlayer);
  const selfMask = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 0;
  const opponentMask = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : 0;
  const min = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : 1;
  const max = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : min;
  const excluded = readCardUid(L, 8);
  const uids = matchingCardUidsWithFilter(L, session, filterRef, player, selfMask, opponentMask, excluded);
  releaseOptionalFunctionRef(L, filterRef);
  const limit = max > 0 ? max : Math.max(min, 1);
  const selected = uids.slice(0, limit);
  if (targetUids) targetUids.splice(0, targetUids.length, ...selected);
  pushGroupTable(L, selected);
  return 1;
}

function matchingCardUidsWithFilter(L: unknown, session: DuelSession, filterRef: number | undefined, player: PlayerId, selfMask: number, opponentMask: number, excluded: string | undefined): string[] {
  return [
    ...matchingCardUids(session, player, selfMask),
    ...matchingCardUids(session, otherPlayer(player), opponentMask),
  ].filter((uid) => uid !== excluded && cardMatchesFilter(L, uid, filterRef));
}

function availableLocationCount(session: DuelSession, player: PlayerId, locationMask: number): number {
  const locations = locationsFromMask(locationMask);
  if (locations.includes("monsterZone")) return Math.max(0, 5 - matchingCardUids(session, player, 0x04).length);
  if (locations.includes("spellTrapZone")) return Math.max(0, 5 - matchingCardUids(session, player, 0x08).length);
  return 99;
}

function matchingCardUids(session: DuelSession, player: PlayerId, locationMask: number): string[] {
  const locations = locationsFromMask(locationMask);
  return session.state.cards
    .filter((card) => card.controller === player && locations.includes(card.location))
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid);
}

function locationsFromMask(mask: number): DuelLocation[] {
  const locations: DuelLocation[] = [];
  if ((mask & 0x01) !== 0) locations.push("deck");
  if ((mask & 0x02) !== 0) locations.push("hand");
  if ((mask & 0x04) !== 0) locations.push("monsterZone");
  if ((mask & 0x08) !== 0) locations.push("spellTrapZone");
  if ((mask & 0x10) !== 0) locations.push("graveyard");
  if ((mask & 0x20) !== 0) locations.push("banished");
  if ((mask & 0x40) !== 0) locations.push("extraDeck");
  return locations;
}

function positionFromMask(mask: number): CardPosition | undefined {
  if ((mask & 0x1) !== 0) return "faceUpAttack";
  if ((mask & 0x4) !== 0) return "faceUpDefense";
  if ((mask & 0x8) !== 0) return "faceDownDefense";
  return undefined;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
