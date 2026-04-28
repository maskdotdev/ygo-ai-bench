import fengari from "fengari";
import { installAuxApi, installConstants, installDebugApi } from "./lua-basic-api.js";
import { scriptFilenameForCard } from "./data-loaders.js";
import {
  banishDuelCard,
  changeDuelCardPosition,
  canMoveDuelCardToLocation,
  damageDuelPlayer,
  destroyDuelCard,
  fusionSummonDuelCard,
  linkSummonDuelCard,
  negateDuelChainLink,
  recoverDuelPlayer,
  registerEffect,
  ritualSummonDuelCard,
  sendDuelCardToGraveyard,
  setDuelPlayerLifePoints,
  specialSummonDuelCard,
  synchroSummonDuelCard,
  xyzSummonDuelCard,
} from "./duel-core.js";
import type { CardPosition, DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelEventName, DuelLocation, DuelSession, PlayerId } from "./duel-types.js";

const { lua, lauxlib, lualib, to_luastring } = fengari;

export interface LuaScriptLoadResult {
  ok: boolean;
  error?: string;
  name: string;
}

export interface LuaScriptHost {
  readonly messages: string[];
  loadScript(code: string, name: string): LuaScriptLoadResult;
  loadCardScript(cardCode: string | number, source: LuaScriptSource): LuaScriptLoadResult;
  registerInitialEffects(): number;
  getGlobalString(name: string): string | undefined;
  getGlobalNumber(name: string): number | undefined;
}

export interface LuaScriptSource {
  readScript(name: string): string | undefined;
}

interface LuaEffectRecord {
  id: number;
  typeFlags: number;
  sourceUid?: string;
  code?: number;
  range?: DuelLocation[];
  countLimit?: number;
  conditionRef?: number;
  costRef?: number;
  targetRef?: number;
  operationRef?: number;
}

interface LuaHostState {
  session: DuelSession;
  nextEffectId: number;
  effects: Map<number, LuaEffectRecord>;
  messages: string[];
  activeTargetUids: string[] | undefined;
}

export function createLuaScriptHost(session: DuelSession): LuaScriptHost {
  const L = lauxlib.luaL_newstate();
  const hostState: LuaHostState = { session, nextEffectId: 1, effects: new Map(), messages: [], activeTargetUids: undefined };
  lualib.luaL_openlibs(L);
  installConstants(L);
  installDebugApi(L, hostState.messages);
  installAuxApi(L, readLuaError);
  installDuelApi(L, session, hostState);
  installEffectApi(L, hostState);
  installCardApi(L, session, hostState);
  installGroupApi(L);

  return {
    messages: hostState.messages,
    loadScript(code, name) {
      const loadStatus = lauxlib.luaL_loadbuffer(L, to_luastring(code), code.length, to_luastring(name));
      if (loadStatus !== lua.LUA_OK) return { ok: false, name, error: readLuaError(L) };
      const callStatus = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
      if (callStatus !== lua.LUA_OK) return { ok: false, name, error: readLuaError(L) };
      return { ok: true, name };
    },
    loadCardScript(cardCode, source) {
      const name = scriptFilenameForCard(cardCode);
      const code = source.readScript(name);
      if (code === undefined) return { ok: false, name, error: `Script ${name} was not found` };
      return this.loadScript(code, name);
    },
    registerInitialEffects() {
      let count = 0;
      for (const card of session.state.cards) {
        lua.lua_getglobal(L, to_luastring(`c${card.code}`));
        if (!lua.lua_istable(L, -1)) {
          lua.lua_pop(L, 1);
          continue;
        }
        lua.lua_getfield(L, -1, to_luastring("initial_effect"));
        if (!lua.lua_isfunction(L, -1)) {
          lua.lua_pop(L, 2);
          continue;
        }
        pushCardTable(L, card.uid);
        const status = lua.lua_pcall(L, 1, 0, 0);
        lua.lua_pop(L, 1);
        if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
        count += 1;
      }
      return count;
    },
    getGlobalString(name) {
      lua.lua_getglobal(L, to_luastring(name));
      const value = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
      lua.lua_pop(L, 1);
      return value;
    },
    getGlobalNumber(name) {
      lua.lua_getglobal(L, to_luastring(name));
      const value = lua.lua_isnumber(L, -1) ? lua.lua_tonumber(L, -1) : undefined;
      lua.lua_pop(L, 1);
      return value;
    },
  };
}

function installDuelApi(L: unknown, session: DuelSession, hostState: LuaHostState): void {
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
    const uids = readCardOrGroupUids(state, 1);
    let moved = 0;
    for (const uid of uids) {
      const card = session.state.cards.find((candidate) => candidate.uid === uid);
      if (!card) continue;
      try {
        sendDuelCardToGraveyard(session.state, uid, card.controller);
        moved += 1;
      } catch {
        // EDOPro-style helpers report the number of moved cards; illegal moves simply fail.
      }
    }
    lua.lua_pushinteger(state, moved);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("SendtoGrave"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids = readCardOrGroupUids(state, 1);
    let moved = 0;
    for (const uid of uids) {
      const card = session.state.cards.find((candidate) => candidate.uid === uid);
      if (!card) continue;
      try {
        destroyDuelCard(session.state, uid, card.controller);
        moved += 1;
      } catch {
        // EDOPro-style helpers report the number of moved cards; illegal moves simply fail.
      }
    }
    lua.lua_pushinteger(state, moved);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Destroy"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids = readCardOrGroupUids(state, 1);
    let moved = 0;
    for (const uid of uids) {
      const card = session.state.cards.find((candidate) => candidate.uid === uid);
      if (!card) continue;
      try {
        banishDuelCard(session.state, uid, card.controller);
        moved += 1;
      } catch {
        // EDOPro-style helpers report the number of moved cards; illegal moves simply fail.
      }
    }
    lua.lua_pushinteger(state, moved);
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
  lua.lua_pushcfunction(L, (state: unknown) => {
    return pushSelectedMatchingGroup(state, session);
  });
  lua.lua_setfield(L, -2, to_luastring("SelectMatchingCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    return pushSelectedMatchingGroup(state, session, hostState.activeTargetUids);
  });
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
  lua.lua_setglobal(L, to_luastring("Duel"));
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

function installEffectApi(L: unknown, hostState: LuaHostState): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const id = hostState.nextEffectId;
    hostState.nextEffectId += 1;
    const sourceUid = readCardUid(state, 1);
    hostState.effects.set(id, { id, typeFlags: 0, ...(sourceUid === undefined ? {} : { sourceUid }) });
    pushEffectTable(state, id, hostState.effects, hostState.session);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CreateEffect"));
  lua.lua_setglobal(L, to_luastring("Effect"));
}

function installCardApi(L: unknown, session: DuelSession, hostState: LuaHostState): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const cardUid = readTableStringField(state, 1, "__duel_uid");
    const effectId = readTableNumberField(state, 2, "__effect_id");
    const card = cardUid ? session.state.cards.find((candidate) => candidate.uid === cardUid) : undefined;
    const luaEffect = effectId === undefined ? undefined : hostState.effects.get(effectId);
    if (!card || !luaEffect) return 0;
    registerEffect(session, toDuelEffect(card, luaEffect, state, hostState));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    lua.lua_pushinteger(state, card ? Number(card.code) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && card.code === requested));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested !== undefined && card.data.setcodes?.includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSetCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    lua.lua_pushboolean(state, Boolean(card?.faceUp));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsFaceup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    lua.lua_pushboolean(state, Boolean(card && !card.faceUp));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsFacedown"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    const requestedPosition = lua.lua_isnumber(state, 2) ? positionFromMask(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requestedPosition && card.position === requestedPosition));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPosition"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    lua.lua_pushboolean(state, Boolean(card && card.position === "faceUpAttack"));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsAttackPos"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    lua.lua_pushboolean(state, Boolean(card && (card.position === "faceUpDefense" || card.position === "faceDownDefense")));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsDefensePos"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    const locationMask = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushboolean(state, Boolean(card && locationsFromMask(locationMask).includes(card.location)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsLocation"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    const player = lua.lua_isnumber(state, 2) ? normalizePlayer(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && player !== undefined && card.controller === player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsControler"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    lua.lua_pushboolean(state, Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard")));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsAbleToGrave"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    lua.lua_pushboolean(state, Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "hand")));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsAbleToHand"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    lua.lua_pushboolean(state, Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "deck")));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsAbleToDeck"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    lua.lua_pushboolean(state, Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "banished")));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsAbleToRemove"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    lua.lua_pushboolean(state, Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "extraDeck")));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsAbleToExtra"));
  lua.lua_setglobal(L, to_luastring("Card"));
}

function installGroupApi(L: unknown): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CreateGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uids = readGroupUids(state, 1);
    if (!uids[0]) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, uids[0]);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetFirst"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, readGroupUids(state, 1).length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetCount"));
  lua.lua_setglobal(L, to_luastring("Group"));
}

function readLuaError(L: unknown): string {
  const message = lua.lua_tojsstring(L, -1) ?? "Lua script error";
  lua.lua_pop(L, 1);
  return message;
}

function pushCardTable(L: unknown, uid: string): void {
  lua.lua_newtable(L);
  lua.lua_pushliteral(L, uid);
  lua.lua_setfield(L, -2, to_luastring("__duel_uid"));
  copyGlobalFunctionToField(L, "Card", "RegisterEffect");
  copyGlobalFunctionToField(L, "Card", "GetCode");
  copyGlobalFunctionToField(L, "Card", "IsCode");
  copyGlobalFunctionToField(L, "Card", "IsSetCard");
  copyGlobalFunctionToField(L, "Card", "IsFaceup");
  copyGlobalFunctionToField(L, "Card", "IsFacedown");
  copyGlobalFunctionToField(L, "Card", "IsPosition");
  copyGlobalFunctionToField(L, "Card", "IsAttackPos");
  copyGlobalFunctionToField(L, "Card", "IsDefensePos");
  copyGlobalFunctionToField(L, "Card", "IsLocation");
  copyGlobalFunctionToField(L, "Card", "IsControler");
  copyGlobalFunctionToField(L, "Card", "IsAbleToGrave");
  copyGlobalFunctionToField(L, "Card", "IsAbleToHand");
  copyGlobalFunctionToField(L, "Card", "IsAbleToDeck");
  copyGlobalFunctionToField(L, "Card", "IsAbleToRemove");
  copyGlobalFunctionToField(L, "Card", "IsAbleToExtra");
}

function pushEffectTable(L: unknown, id: number, effects: Map<number, LuaEffectRecord>, session: DuelSession): void {
  lua.lua_newtable(L);
  lua.lua_pushinteger(L, id);
  lua.lua_setfield(L, -2, to_luastring("__effect_id"));
  pushEffectMethod(L, effects, "GetHandler", (state, effect) => {
    if (!effect.sourceUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, effect.sourceUid);
    return 1;
  });
  pushEffectMethod(L, effects, "GetHandlerPlayer", (state, effect) => {
    const source = effect.sourceUid ? session.state.cards.find((candidate) => candidate.uid === effect.sourceUid) : undefined;
    lua.lua_pushinteger(state, source?.controller ?? 0);
    return 1;
  });
  pushEffectMethod(L, effects, "SetType", setEffectNumberField("typeFlags"));
  pushEffectMethod(L, effects, "SetCode", setEffectNumberField("code"));
  pushEffectMethod(L, effects, "SetRange", (state, effect) => {
    const firstRange = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    if (firstRange !== undefined) effect.range = locationsFromMask(firstRange);
    return 0;
  });
  pushEffectMethod(L, effects, "SetCountLimit", (state, effect) => {
    effect.countLimit = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1;
    return 0;
  });
  pushEffectMethod(L, effects, "SetCondition", setEffectFunctionField("conditionRef"));
  pushEffectMethod(L, effects, "SetCost", setEffectFunctionField("costRef"));
  pushEffectMethod(L, effects, "SetTarget", setEffectFunctionField("targetRef"));
  pushEffectMethod(L, effects, "SetOperation", (state, effect) => {
    if (!lua.lua_isfunction(state, 2)) return 0;
    lua.lua_pushvalue(state, 2);
    effect.operationRef = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    return 0;
  });
}

function pushEffectMethod(L: unknown, effects: Map<number, LuaEffectRecord>, name: string, handler: (state: unknown, effect: LuaEffectRecord) => number): void {
  lua.lua_pushjsfunction(L, (state: unknown) => {
    const effectId = readTableNumberField(state, 1, "__effect_id");
    const effect = effectId === undefined ? undefined : effects.get(effectId);
    return effect ? handler(state, effect) : 0;
  });
  lua.lua_setfield(L, -2, to_luastring(name));
}

function setEffectNumberField(field: "typeFlags" | "code") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    if (lua.lua_isnumber(state, 2)) effect[field] = lua.lua_tointeger(state, 2);
    return 0;
  };
}

function setEffectFunctionField(field: "conditionRef" | "costRef" | "targetRef") {
  return (state: unknown, effect: LuaEffectRecord): number => {
    if (!lua.lua_isfunction(state, 2)) return 0;
    lua.lua_pushvalue(state, 2);
    effect[field] = lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX);
    return 0;
  };
}

function toDuelEffect(card: DuelCardInstance, luaEffect: LuaEffectRecord, L: unknown, hostState: LuaHostState): DuelEffectDefinition {
  const event = (luaEffect.typeFlags & 0x20) !== 0 ? "trigger" : (luaEffect.typeFlags & 0x100) !== 0 ? "quick" : "ignition";
  const range = luaEffect.range ?? [card.location];
  const triggerEvent = triggerEventFromCode(luaEffect.code);
  luaEffect.sourceUid = card.uid;
  return {
    id: `lua-${luaEffect.id}${luaEffect.code === undefined ? "" : `-${luaEffect.code}`}`,
    sourceUid: card.uid,
    controller: card.controller,
    event,
    ...(triggerEvent === undefined ? {} : { triggerEvent }),
    range,
    oncePerTurn: (luaEffect.countLimit ?? 0) > 0,
    canActivate: () => callLuaEffectBoolean(L, hostState, luaEffect, card, luaEffect.conditionRef, true),
    cost: () => callLuaEffectBoolean(L, hostState, luaEffect, card, luaEffect.costRef, true),
    target: (ctx) => callLuaEffectBoolean(L, hostState, luaEffect, card, luaEffect.targetRef, true, ctx),
    operation: (ctx) => {
      if (luaEffect.operationRef === undefined) {
        ctx.log("Lua effect resolved without an operation");
        return;
      }
      withActiveTargets(hostState, ctx.targetUids, () => {
        lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, luaEffect.operationRef);
        pushEffectTable(L, luaEffect.id, hostState.effects, hostState.session);
        pushCardTable(L, card.uid);
        const status = lua.lua_pcall(L, 2, 0, 0);
        if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
        ctx.log("Lua effect operation resolved");
      });
    },
  };
}

function triggerEventFromCode(code: number | undefined): DuelEventName | undefined {
  if (code === 1001) return "flipSummoned";
  if (code === 0x40) return "normalSummoned";
  if (code === 0x80) return "specialSummoned";
  if (code === 0x400) return "sentToGraveyard";
  if (code === 1016) return "positionChanged";
  if (code === 1130) return "attackDeclared";
  if (code === 1140) return "battleDestroyed";
  return undefined;
}

function callLuaEffectBoolean(L: unknown, hostState: LuaHostState, luaEffect: LuaEffectRecord, card: DuelCardInstance, ref: number | undefined, fallback: boolean, ctx?: DuelEffectContext): boolean {
  if (ref === undefined) return fallback;
  return withActiveTargets(hostState, ctx?.targetUids, () => {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
    pushEffectTable(L, luaEffect.id, hostState.effects, hostState.session);
    pushCardTable(L, card.uid);
    const status = lua.lua_pcall(L, 2, 1, 0);
    if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
    const result = lua.lua_isnil(L, -1) ? fallback : Boolean(lua.lua_toboolean(L, -1));
    lua.lua_pop(L, 1);
    return result;
  });
}

function withActiveTargets<T>(hostState: LuaHostState, targetUids: string[] | undefined, callback: () => T): T {
  const previous = hostState.activeTargetUids;
  hostState.activeTargetUids = targetUids;
  try {
    return callback();
  } finally {
    hostState.activeTargetUids = previous;
  }
}

function copyGlobalFunctionToField(L: unknown, tableName: string, fieldName: string): void {
  lua.lua_getglobal(L, to_luastring(tableName));
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  lua.lua_setfield(L, -3, to_luastring(fieldName));
  lua.lua_pop(L, 1);
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

function readTableStringField(L: unknown, index: number, fieldName: string): string | undefined {
  lua.lua_getfield(L, index, to_luastring(fieldName));
  const value = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

function readTableNumberField(L: unknown, index: number, fieldName: string): number | undefined {
  lua.lua_getfield(L, index, to_luastring(fieldName));
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
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
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
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

function matchingCardUids(session: DuelSession, player: PlayerId, locationMask: number): string[] {
  const locations = locationsFromMask(locationMask);
  return session.state.cards
    .filter((card) => card.controller === player && locations.includes(card.location))
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid);
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
