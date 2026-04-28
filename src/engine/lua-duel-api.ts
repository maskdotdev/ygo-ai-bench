import fengari from "fengari";
import {
  banishDuelCard,
  changeDuelCardPosition,
  canMoveDuelCardToLocation,
  damageDuelPlayer,
  drawDuelCards,
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
  moveDuelCard,
  xyzSummonDuelCard,
} from "./duel-core.js";
import { pushCardTable } from "./lua-card-api.js";
import { pushGroupTable } from "./lua-group-api.js";
import {
  locationsFromMask,
  positionFromMask,
  readCardUid,
  readGroupUids,
  readOptionalFunctionRef,
  releaseOptionalFunctionRef,
} from "./lua-api-utils.js";
import { shuffle } from "./rng.js";
import type { CardPosition, DuelLocation, DuelSession, PlayerId } from "./duel-types.js";

const { lua, to_luastring } = fengari;

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
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    lua.lua_pushboolean(state, topDeckUids(session, player, count).length >= count);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanDraw"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1;
    lua.lua_pushinteger(state, drawDuelCards(session.state, player, count, "Lua draw"));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Draw"));
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
    lua.lua_pushinteger(state, moveCardOrGroup(session, state, sendDuelCardToGraveyard));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Release"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, moveCardOrGroupToLocation(session, state, "hand"));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SendtoHand"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, moveCardOrGroupToLocation(session, state, "deck"));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SendtoDeck"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, moveCardOrGroupToLocation(session, state, "extraDeck"));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SendtoExtraP"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids = readCardOrGroupUids(state, 1);
    const targetPlayer = readOptionalPlayer(state, 4);
    const requestedPosition = lua.lua_isnumber(state, 7) ? positionFromMask(lua.lua_tointeger(state, 7)) : undefined;
    let moved = 0;
    for (const uid of uids) {
      const card = session.state.cards.find((candidate) => candidate.uid === uid);
      if (!card) continue;
      try {
        const summoned = specialSummonDuelCard(session.state, uid, targetPlayer ?? card.controller);
        if (requestedPosition) applySummonPosition(summoned, requestedPosition);
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
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const selfMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const opponentMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    pushGroupTable(state, fieldGroupUids(session, player, selfMask, opponentMask));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFieldGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const selfMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    const opponentMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0;
    lua.lua_pushinteger(state, fieldGroupUids(session, player, selfMask, opponentMask).length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFieldGroupCount"));
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
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    lua.lua_pushinteger(state, availableMonsterZoneCount(session, player, readCardOrGroupUids(state, 2)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetMZoneCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const positionMask = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 0x1;
    lua.lua_pushinteger(state, positionMaskFromPosition(positionFromMask(positionMask) ?? "faceUpAttack"));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectPosition"));
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
    shuffleDeck(session, player);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ShuffleDeck"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const minimum = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    const excluded = readCardUid(state, 4);
    const count = matchingCardUidsWithFilter(state, session, filterRef, player, 0x04, 0, excluded).length;
    releaseOptionalFunctionRef(state, filterRef);
    lua.lua_pushboolean(state, count >= minimum);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckReleaseGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const filterRef = readOptionalFunctionRef(state, 2);
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const min = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : 1;
    const max = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : min;
    const excluded = readCardUid(state, 5);
    const uids = matchingCardUidsWithFilter(state, session, filterRef, player, 0x04, 0, excluded);
    releaseOptionalFunctionRef(state, filterRef);
    pushGroupTable(state, uids.slice(0, max > 0 ? max : Math.max(min, 1)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SelectReleaseGroup"));
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

function moveCardOrGroupToLocation(session: DuelSession, L: unknown, location: DuelLocation): number {
  let moved = 0;
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card || !canMoveDuelCardToLocation(session.state, uid, location)) continue;
    moveDuelCard(session.state, uid, location, readOptionalPlayer(L, 2) ?? card.controller);
    moved += 1;
  }
  return moved;
}

function applySummonPosition(card: { position: CardPosition; faceUp: boolean }, position: CardPosition): void {
  card.position = position;
  card.faceUp = position !== "faceDownDefense";
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

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
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
  return fieldGroupUids(session, player, selfMask, opponentMask).filter((uid) => uid !== excluded && cardMatchesFilter(L, uid, filterRef));
}

function fieldGroupUids(session: DuelSession, player: PlayerId, selfMask: number, opponentMask: number): string[] {
  return [
    ...matchingCardUids(session, player, selfMask),
    ...matchingCardUids(session, otherPlayer(player), opponentMask),
  ];
}

function availableLocationCount(session: DuelSession, player: PlayerId, locationMask: number): number {
  const locations = locationsFromMask(locationMask);
  if (locations.includes("monsterZone")) return availableMonsterZoneCount(session, player, []);
  if (locations.includes("spellTrapZone")) return Math.max(0, 5 - matchingCardUids(session, player, 0x08).length);
  return 99;
}

function availableMonsterZoneCount(session: DuelSession, player: PlayerId, excludedUids: string[]): number {
  const occupied = session.state.cards.filter((card) => card.controller === player && card.location === "monsterZone" && !excludedUids.includes(card.uid)).length;
  return Math.max(0, 5 - occupied);
}

function topDeckUids(session: DuelSession, player: PlayerId, count: number): string[] {
  return matchingCardUids(session, player, 0x01).slice(0, count);
}

function shuffleDeck(session: DuelSession, player: PlayerId): void {
  const deckCards = session.state.cards.filter((card) => card.controller === player && card.location === "deck").sort((a, b) => a.sequence - b.sequence);
  const shuffled = shuffle(deckCards, `${session.state.seed}:lua-shuffle:${player}:${session.state.log.length}`);
  for (const [sequence, card] of shuffled.entries()) card.sequence = sequence;
}

function matchingCardUids(session: DuelSession, player: PlayerId, locationMask: number): string[] {
  const locations = locationsFromMask(locationMask);
  return session.state.cards
    .filter((card) => card.controller === player && locations.includes(card.location))
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid);
}

function positionMaskFromPosition(position: CardPosition): number {
  if (position === "faceUpAttack") return 0x1;
  if (position === "faceUpDefense") return 0x4;
  if (position === "faceDownDefense") return 0x8;
  return 0;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function readOptionalPlayer(L: unknown, index: number): PlayerId | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const value = lua.lua_tointeger(L, index);
  if (value !== 0 && value !== 1) return undefined;
  return value;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
