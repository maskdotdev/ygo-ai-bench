import fengari from "fengari";
import { pushCardTable } from "#lua/card-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import { readGroupUids, readOptionalFunctionRef, releaseOptionalFunctionRef } from "#lua/api-utils.js";
import { installAuxCostApi } from "#lua/aux-cost-api.js";
import { installAuxUtilityApi } from "#lua/aux-utility-api.js";
import { installEquipProcedureApi } from "#lua/equip-procedure-api.js";
import { installLabrynthApi } from "#lua/labrynth-api.js";
import { installMaleficApi } from "#lua/malefic-api.js";
import { installNeosReturnApi } from "#lua/neos-return-api.js";
import { installNormalProcedureApi } from "#lua/normal-procedure-api.js";
import { installPersistentProcedureApi } from "#lua/persistent-procedure-api.js";
import { installRankUpApi } from "#lua/rank-up-api.js";
import { installSkillProcedureApi } from "#lua/skill-procedure-api.js";
import { installUnionProcedureApi } from "#lua/union-procedure-api.js";
import type { DuelSession } from "#duel/types.js";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, lauxlib, to_luastring } = fengari;

export function installAuxApi(L: unknown, readLuaError: (state: unknown) => string, session?: DuelSession, hostState?: LuaHostState): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const code = lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0;
    const index = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushnumber(state, code * 16 + index);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Stringid"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, true);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("TRUE"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, false);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("FALSE"));
  lua.lua_pushcfunction(L, (state: unknown) => pushFilterBoolFunction(state, readLuaError));
  lua.lua_setfield(L, -2, to_luastring("FilterBoolFunction"));
  pushFixedFilterWrapper(L, "FilterBoolFunctionEx", readLuaError, false, hostState);
  pushFixedFilterWrapper(L, "TargetBoolFunction", readLuaError, false, hostState);
  pushFixedFilterWrapper(L, "FaceupFilter", readLuaError, true, hostState);
  lua.lua_pushcfunction(L, (state: unknown) => pushBattleDestroyedCondition(state, session, false, false));
  lua.lua_setfield(L, -2, to_luastring("bdcon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushBattleDestroyedCondition(state, session, true, false));
  lua.lua_setfield(L, -2, to_luastring("bdocon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushBattleDestroyedCondition(state, session, false, true));
  lua.lua_setfield(L, -2, to_luastring("bdgcon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushBattleDestroyedCondition(state, session, true, true));
  lua.lua_setfield(L, -2, to_luastring("bdogcon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectUnselectGroup(state));
  lua.lua_setfield(L, -2, to_luastring("SelectUnselectGroup"));
  lua.lua_newtable(L);
  lua.lua_setfield(L, -2, to_luastring("Drawless"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAddDrawless(state));
  lua.lua_setfield(L, -2, to_luastring("AddDrawless"));
  lua.lua_pushcfunction(L, (state: unknown) => pushDrawlessOperation(state, readLuaError, session));
  lua.lua_setfield(L, -2, to_luastring("drawlessop"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckZonesReleaseSummonCheck(state, false));
  lua.lua_setfield(L, -2, to_luastring("CheckZonesReleaseSummonCheck"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckZonesReleaseSummonCheck(state, true));
  lua.lua_setfield(L, -2, to_luastring("CheckZonesReleaseSummonCheckSelection"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAuxNext(state));
  lua.lua_setfield(L, -2, to_luastring("Next"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAuxIsZone(state, readLuaError));
  lua.lua_setfield(L, -2, to_luastring("IsZone"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSpElimFilter(state, readLuaError));
  lua.lua_setfield(L, -2, to_luastring("SpElimFilter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGlobalCheck(state, readLuaError));
  lua.lua_setfield(L, -2, to_luastring("GlobalCheck"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNecroValleyFilter(state, readLuaError));
  lua.lua_setfield(L, -2, to_luastring("NecroValleyFilter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNecroValleyPredicate(state, readLuaError));
  lua.lua_setfield(L, -2, to_luastring("nvfilter"));
  lua.lua_setglobal(L, to_luastring("aux"));
  installAuxCostApi(L, readLuaError);
  installAuxUtilityApi(L, readLuaError);
  installEquipProcedureApi(L, readLuaError);
  installLabrynthApi(L);
  installMaleficApi(L, readLuaError);
  installNeosReturnApi(L, readLuaError);
  installNormalProcedureApi(L, readLuaError);
  installPersistentProcedureApi(L, readLuaError);
  installRankUpApi(L, readLuaError);
  installUnionProcedureApi(L, readLuaError);
  installSkillProcedureApi(L, readLuaError);
  installAuxCompatibilityApi(L);
}

function installAuxCompatibilityApi(L: unknown): void {
  const source = `
    function aux.CanActivateSkill(tp)
      return Duel.GetCurrentChain()==0 and Duel.IsTurnPlayer(tp) and Duel.IsMainPhase()
    end
    Auxiliary=Auxiliary or aux
    Auxiliary.CanActivateSkill=aux.CanActivateSkill
    function aux.createTempLizardCheck(c,filter,reset,tRange,tRange2,resetcount)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(CARD_CLOCK_LIZARD or 51476410)
      e1:SetTargetRange(tRange or 0xff,tRange2 or 0)
      e1:SetReset(reset or (RESET_PHASE|PHASE_END),resetcount)
      e1:SetTarget(filter or aux.TRUE)
      e1:SetValue(1)
      return e1
    end
    function aux.addTempLizardCheck(c,tp,filter,reset,tRange,tRange2,resetcount)
      local e1=aux.createTempLizardCheck(c,filter,reset,tRange,tRange2,resetcount)
      Duel.RegisterEffect(e1,tp)
      return e1
    end
    function aux.createContinuousLizardCheck(c,location,filter,tRange,tRange2)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(CARD_CLOCK_LIZARD or 51476410)
      e1:SetTargetRange(tRange or 0xff,tRange2 or 0)
      e1:SetRange(location)
      e1:SetTarget(filter or aux.TRUE)
      e1:SetValue(1)
      return e1
    end
    function aux.addContinuousLizardCheck(c,location,filter,tRange,tRange2)
      local e1=aux.createContinuousLizardCheck(c,location,filter,tRange,tRange2)
      c:RegisterEffect(e1)
      return e1
    end
    Auxiliary.createTempLizardCheck=aux.createTempLizardCheck
    Auxiliary.addTempLizardCheck=aux.addTempLizardCheck
    Auxiliary.createContinuousLizardCheck=aux.createContinuousLizardCheck
    Auxiliary.addContinuousLizardCheck=aux.addContinuousLizardCheck
    function aux.LP0ActivationValidity(eff)
      local ge1=Effect.GlobalEffect()
      ge1:SetType(EFFECT_TYPE_FIELD)
      ge1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
      ge1:SetTargetRange(1,0)
      ge1:SetCode(511000793)
      ge1:SetCondition(function(e) return not eff.IsActivatable or eff:IsActivatable(e:GetHandlerPlayer()) end)
      Duel.RegisterEffect(ge1,0)
      local ge2=ge1:Clone()
      Duel.RegisterEffect(ge2,1)
    end
    function AA.eqsfilter(c,tp)
      return c:IsSetCard(SET_ATTRACTION or 0x15f) and c:IsTrap() and c:GetEquipTarget()
        and Duel.IsExistingMatchingCard(AA.eqmfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,c:GetEquipTarget(),tp)
    end
    function AA.eqmfilter(c,tp)
      return c:IsFaceup() and (c:IsSetCard(SET_AMAZEMENT or 0x15e) or (not c:IsControler(tp)))
    end
    function AA.qeqetg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return false end
      if chk==0 then return Duel.IsExistingTarget(AA.eqsfilter,tp,LOCATION_SZONE,0,1,nil,tp) end
      Duel.SelectTarget(tp,AA.eqsfilter,tp,LOCATION_SZONE,0,1,1,nil,tp)
    end
    function AA.qeqeop(e,tp,eg,ep,ev,re,r,rp)
      local tc=Duel.GetTargetCards(e):GetFirst()
      if not tc then return end
      local mg=Duel.GetMatchingGroup(AA.eqmfilter,tp,LOCATION_MZONE,LOCATION_MZONE,tc:GetEquipTarget(),tp)
      local mc=mg:GetFirst()
      if tc:IsFaceup() and tc:IsRelateToEffect(e) and mc and mc:IsFaceup() then Duel.Equip(tp,tc,mc) end
    end
    function aux.AddAmazementQuickEquipEffect(c,id)
      local e2=Effect.CreateEffect(c)
      e2:SetDescription(aux.Stringid(id,1))
      e2:SetType(EFFECT_TYPE_QUICK_O)
      e2:SetCode(EVENT_FREE_CHAIN)
      e2:SetRange(LOCATION_MZONE)
      e2:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e2:SetCountLimit(1,id)
      e2:SetTarget(AA.qeqetg)
      e2:SetOperation(AA.qeqeop)
      c:RegisterEffect(e2)
      return e2
    end
  `;
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(source), source.length, to_luastring("aux-compat.lua"));
  if (status === lua.LUA_OK) lua.lua_pcall(L, 0, 0, 0);
  else lua.lua_pop(L, 1);
}

function pushBattleDestroyedCondition(L: unknown, session: DuelSession | undefined, requireOpponent: boolean, requireGraveMonster: boolean): number {
  const triggerPlayer = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const eventUids = readGroupUids(L, 3);
  const eventPlayer = readEventPlayer(L, 4);
  const matches = requireGraveMonster ? eventUids.some((uid) => isBattleDestroyedMonster(session, uid)) : eventUids.length > 0;
  lua.lua_pushboolean(L, matches && (!requireOpponent || triggerPlayer === undefined || eventPlayer === undefined || eventPlayer !== triggerPlayer));
  return 1;
}

function isBattleDestroyedMonster(session: DuelSession | undefined, uid: string): boolean {
  const card = session?.state.cards.find((candidate) => candidate.uid === uid);
  return !session || Boolean(card && isMonsterCard(card));
}

function isMonsterCard(card: NonNullable<DuelSession["state"]["cards"][number]>): boolean {
  return card.kind === "monster" || card.kind === "extra" || ((card.data.typeFlags ?? 0x1) & 0x1) !== 0;
}

function readEventPlayer(L: unknown, index: number): number | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  return lua.lua_tointeger(L, index);
}

function pushGlobalCheck(L: unknown, readLuaError: (state: unknown) => string): number {
  if (!lua.lua_istable(L, 1) || !lua.lua_isfunction(L, 2)) return 0;
  lua.lua_getfield(L, 1, to_luastring("global_check"));
  const alreadyChecked = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  if (alreadyChecked) return 0;
  lua.lua_pushboolean(L, true);
  lua.lua_setfield(L, 1, to_luastring("global_check"));
  lua.lua_pushvalue(L, 2);
  const status = lua.lua_pcall(L, 0, 0, 0);
  if (status !== lua.LUA_OK) return lauxlib.luaL_error(L, to_luastring(readLuaError(L)));
  return 0;
}

function pushFilterBoolFunction(L: unknown, readLuaError: (state: unknown) => string): number {
  if (!lua.lua_isfunction(L, 1)) {
    lua.lua_pushnil(L);
    return 1;
  }
  const extraArgCount = lua.lua_gettop(L) - 1;
  const refs: number[] = [];
  lua.lua_pushvalue(L, 1);
  refs.push(lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX));
  for (let index = 0; index < extraArgCount; index += 1) {
    lua.lua_pushvalue(L, index + 2);
    refs.push(lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX));
  }
  lua.lua_pushjsfunction(L, (state: unknown) => {
    lua.lua_rawgeti(state, lua.LUA_REGISTRYINDEX, refs[0]);
    lua.lua_pushvalue(state, 1);
    for (let index = 1; index < refs.length; index += 1) lua.lua_rawgeti(state, lua.LUA_REGISTRYINDEX, refs[index]);
    const status = lua.lua_pcall(state, refs.length, 1, 0);
    if (status !== lua.LUA_OK) return lauxlib.luaL_error(state, to_luastring(readLuaError(state)));
    return 1;
  });
  return 1;
}

function pushAuxIsZone(L: unknown, readLuaError: (state: unknown) => string): number {
  const zone = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const player = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  const sequence = callLuaNumberMethod(L, 1, "GetSequence", readLuaError);
  const isController = callLuaBooleanMethod(L, 1, "IsControler", readLuaError, player);
  let relativeZone = isController ? 1 << sequence : 1 << (16 + sequence);
  if (sequence === 5 || sequence === 6) relativeZone |= isController ? 1 << (16 + 11 - sequence) : 1 << (11 - sequence);
  lua.lua_pushboolean(L, (relativeZone & zone) !== 0);
  return 1;
}

function pushNecroValleyFilter(L: unknown, readLuaError: (state: unknown) => string): number {
  if (!lua.lua_isfunction(L, 1)) {
    lua.lua_pushnil(L);
    return 1;
  }
  lua.lua_pushvalue(L, 1);
  const ref = lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
  lua.lua_pushjsfunction(L, (state: unknown) => {
    const argCount = lua.lua_gettop(state);
    lua.lua_rawgeti(state, lua.LUA_REGISTRYINDEX, ref);
    for (let index = 1; index <= argCount; index += 1) lua.lua_pushvalue(state, index);
    const status = lua.lua_pcall(state, argCount, 1, 0);
    if (status !== lua.LUA_OK) return lauxlib.luaL_error(state, to_luastring(readLuaError(state)));
    return 1;
  });
  return 1;
}

function pushNecroValleyPredicate(L: unknown, readLuaError: (state: unknown) => string): number {
  lua.lua_pushboolean(L, !callLuaBooleanMethod(L, 1, "IsHasEffect", readLuaError, 291));
  return 1;
}

function pushSpElimFilter(L: unknown, readLuaError: (state: unknown) => string): number {
  const mustBeFaceup = lua.lua_toboolean(L, 2);
  const includeMonsterZone = lua.lua_toboolean(L, 3);
  const isMonster = callLuaBooleanMethod(L, 1, "IsMonster", readLuaError);
  if (!isMonster) {
    lua.lua_pushboolean(L, includeMonsterZone || callLuaBooleanMethod(L, 1, "IsLocation", readLuaError, 0x10));
    return 1;
  }
  const inMonsterZone = callLuaBooleanMethod(L, 1, "IsLocation", readLuaError, 0x04);
  if (mustBeFaceup && inMonsterZone && callLuaBooleanMethod(L, 1, "IsFacedown", readLuaError)) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const affectedBySpiritElimination = callIsPlayerAffectedByEffect(L, 1, 69832741, readLuaError);
  const inGraveyard = callLuaBooleanMethod(L, 1, "IsLocation", readLuaError, 0x10);
  lua.lua_pushboolean(L, includeMonsterZone ? inMonsterZone || !affectedBySpiritElimination : affectedBySpiritElimination ? inMonsterZone : inGraveyard);
  return 1;
}

function callIsPlayerAffectedByEffect(L: unknown, cardIndex: number, code: number, readLuaError: (state: unknown) => string): boolean {
  const top = lua.lua_gettop(L);
  lua.lua_getglobal(L, to_luastring("Duel"));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, lua.lua_gettop(L) - top);
    return false;
  }
  lua.lua_getfield(L, -1, to_luastring("IsPlayerAffectedByEffect"));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, lua.lua_gettop(L) - top);
    return false;
  }
  const player = callLuaNumberMethod(L, cardIndex, "GetControler", readLuaError);
  lua.lua_pushinteger(L, player);
  lua.lua_pushinteger(L, code);
  const status = lua.lua_pcall(L, 2, 1, 0);
  if (status !== lua.LUA_OK) return Boolean(lauxlib.luaL_error(L, to_luastring(readLuaError(L))));
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, lua.lua_gettop(L) - top);
  return Boolean(result);
}

function callLuaBooleanMethod(L: unknown, tableIndex: number, methodName: string, readLuaError: (state: unknown) => string, ...args: number[]): boolean {
  const top = lua.lua_gettop(L);
  const absoluteIndex = lua.lua_absindex(L, tableIndex);
  lua.lua_getfield(L, absoluteIndex, to_luastring(methodName));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, lua.lua_gettop(L) - top);
    return false;
  }
  lua.lua_pushvalue(L, absoluteIndex);
  for (const arg of args) lua.lua_pushinteger(L, arg);
  const status = lua.lua_pcall(L, args.length + 1, 1, 0);
  if (status !== lua.LUA_OK) return Boolean(lauxlib.luaL_error(L, to_luastring(readLuaError(L))));
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, lua.lua_gettop(L) - top);
  return Boolean(result);
}

function callLuaNumberMethod(L: unknown, tableIndex: number, methodName: string, readLuaError: (state: unknown) => string): number {
  const top = lua.lua_gettop(L);
  const absoluteIndex = lua.lua_absindex(L, tableIndex);
  lua.lua_getfield(L, absoluteIndex, to_luastring(methodName));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, lua.lua_gettop(L) - top);
    return 0;
  }
  lua.lua_pushvalue(L, absoluteIndex);
  const status = lua.lua_pcall(L, 1, 1, 0);
  if (status !== lua.LUA_OK) return Number(lauxlib.luaL_error(L, to_luastring(readLuaError(L))));
  const result = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : 0;
  lua.lua_pop(L, lua.lua_gettop(L) - top);
  return result;
}

function pushAuxNext(L: unknown): number {
  const uids = readGroupUids(L, 1);
  let index = 0;
  lua.lua_pushjsfunction(L, (state: unknown) => {
    const uid = uids[index];
    index += 1;
    if (!uid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, uid);
    return 1;
  });
  return 1;
}

function pushSelectUnselectGroup(L: unknown): number {
  const uids = readGroupUids(L, 1);
  if (isUpstreamSelectUnselectShape(L)) {
    const min = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 1;
    const max = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : min;
    const filterRef = readOptionalFunctionRef(L, 6);
    const selected = filterRef === undefined ? selectGroupUids(uids, min, max) : selectSubGroupWithUpstreamArgs(L, uids, filterRef, min, max) ?? [];
    releaseOptionalFunctionRef(L, filterRef);
    if (lua.lua_isnumber(L, 7) && lua.lua_tointeger(L, 7) === 0) lua.lua_pushboolean(L, selected.length >= Math.max(0, min));
    else pushGroupTable(L, selected);
    return 1;
  }
  const min = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  const max = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : min;
  const filterRef = readOptionalFunctionRef(L, 7);
  const selected = filterRef === undefined ? selectGroupUids(uids, min, max) : selectSubGroup(L, uids, filterRef, min, max, 8) ?? [];
  releaseOptionalFunctionRef(L, filterRef);
  pushGroupTable(L, selected);
  return 1;
}

function isUpstreamSelectUnselectShape(L: unknown): boolean {
  return lua.lua_isfunction(L, 6) || lua.lua_isnoneornil(L, 6);
}

function pushAddDrawless(L: unknown): number {
  if (!lua.lua_istable(L, 1)) return 0;
  const type = lua.lua_type(L, 2);
  const value = type === lua.LUA_TNUMBER ? lua.lua_tointeger(L, 2) : lua.lua_toboolean(L, 2) ? 1 : 0;
  if (value <= 0) return 0;
  lua.lua_getglobal(L, to_luastring("aux"));
  lua.lua_getfield(L, -1, to_luastring("Drawless"));
  lua.lua_pushvalue(L, 1);
  lua.lua_pushinteger(L, value);
  lua.lua_settable(L, -3);
  lua.lua_pop(L, 2);
  return 0;
}

function pushDrawlessOperation(L: unknown, readLuaError: (state: unknown) => string, session: DuelSession | undefined): number {
  callLuaVoidMethod(L, 1, "Reset", readLuaError);
  const reductions: [number, number] = [0, 0];
  lua.lua_getglobal(L, to_luastring("aux"));
  lua.lua_getfield(L, -1, to_luastring("Drawless"));
  if (lua.lua_istable(L, -1)) {
    lua.lua_pushnil(L);
    while (lua.lua_next(L, -2) !== 0) {
      const player = callLuaNumberMethod(L, -2, "GetControler", readLuaError);
      const value = lua.lua_isnumber(L, -1) ? Math.max(0, lua.lua_tointeger(L, -1)) : 0;
      if (player === 0) reductions[0] += value;
      else if (player === 1) reductions[1] += value;
      lua.lua_pop(L, 1);
    }
  }
  lua.lua_pop(L, 2);
  if (session && session.state.status !== "ended") session.state.options.startingHandSize = Math.max(0, session.state.options.startingHandSize - Math.max(...reductions));
  return 0;
}

function pushCheckZonesReleaseSummonCheck(L: unknown, requireMustIncluded: boolean): number {
  const mustUids = readGroupUids(L, 1);
  const oneOfUids = readGroupUids(L, 2);
  const checkRef = readOptionalFunctionRef(L, 3);
  lua.lua_pushjsfunction(L, (state: unknown) => {
    const selected = readGroupUids(state, 1);
    const candidate = uniqueUids([...selected, ...mustUids]);
    const oneOfCount = selected.filter((uid) => oneOfUids.includes(uid)).length;
    lua.lua_pushboolean(state, (!requireMustIncluded || includesAll(selected, mustUids)) && oneOfCount < 2 && zoneReleaseCheckMatches(state, checkRef, candidate));
    lua.lua_pushboolean(state, oneOfCount >= 2);
    return 2;
  });
  return 1;
}

function callLuaVoidMethod(L: unknown, tableIndex: number, methodName: string, readLuaError: (state: unknown) => string): void {
  const top = lua.lua_gettop(L);
  const absoluteIndex = lua.lua_absindex(L, tableIndex);
  if (!lua.lua_istable(L, absoluteIndex)) return;
  lua.lua_getfield(L, absoluteIndex, to_luastring(methodName));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, lua.lua_gettop(L) - top);
    return;
  }
  lua.lua_pushvalue(L, absoluteIndex);
  const status = lua.lua_pcall(L, 1, 0, 0);
  if (status !== lua.LUA_OK) lauxlib.luaL_error(L, to_luastring(readLuaError(L)));
  lua.lua_pop(L, lua.lua_gettop(L) - top);
}

function zoneReleaseCheckMatches(L: unknown, checkRef: number | undefined, uids: string[]): boolean {
  if (checkRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, checkRef);
  pushGroupTable(L, uids);
  const status = lua.lua_pcall(L, 1, 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function selectGroupUids(uids: string[], min: number, max: number): string[] {
  const boundedMin = Math.max(0, min);
  if (uids.length < boundedMin) return [];
  const limit = max > 0 ? Math.max(boundedMin, max) : uids.length;
  return uids.slice(0, limit);
}

function includesAll(uids: string[], included: string[]): boolean {
  return included.every((uid) => uids.includes(uid));
}

function uniqueUids(uids: string[]): string[] {
  return [...new Set(uids)];
}

function selectSubGroup(L: unknown, uids: string[], filterRef: number, min: number, max: number, argsStart: number): string[] | undefined {
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  return findSubGroupSelection(L, uids, filterRef, boundedMin, boundedMax, argsStart, 0, []);
}

function selectSubGroupWithUpstreamArgs(L: unknown, uids: string[], filterRef: number, min: number, max: number): string[] | undefined {
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  return findUpstreamSubGroupSelection(L, uids, filterRef, boundedMin, boundedMax, 0, []);
}

function findSubGroupSelection(L: unknown, uids: string[], filterRef: number, min: number, max: number, argsStart: number, index: number, selected: string[]): string[] | undefined {
  if (selected.length >= min && selected.length <= max && auxGroupPredicateMatches(L, selected, filterRef, argsStart)) return [...selected];
  if (index >= uids.length || selected.length >= max) return undefined;
  for (let nextIndex = index; nextIndex < uids.length; nextIndex += 1) {
    const uid = uids[nextIndex];
    if (!uid) continue;
    selected.push(uid);
    const found = findSubGroupSelection(L, uids, filterRef, min, max, argsStart, nextIndex + 1, selected);
    if (found) return found;
    selected.pop();
  }
  return undefined;
}

function auxGroupPredicateMatches(L: unknown, uids: string[], filterRef: number, argsStart: number): boolean {
  const top = lua.lua_gettop(L);
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushGroupTable(L, uids);
  for (let index = argsStart; index <= top; index += 1) lua.lua_pushvalue(L, index);
  const status = lua.lua_pcall(L, Math.max(1, top - argsStart + 2), 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function findUpstreamSubGroupSelection(L: unknown, uids: string[], filterRef: number, min: number, max: number, index: number, selected: string[]): string[] | undefined {
  if (selected.length >= min && selected.length <= max && upstreamAuxGroupPredicateMatches(L, selected, uids, filterRef)) return [...selected];
  if (index >= uids.length || selected.length >= max) return undefined;
  for (let nextIndex = index; nextIndex < uids.length; nextIndex += 1) {
    const uid = uids[nextIndex];
    if (!uid) continue;
    selected.push(uid);
    const found = findUpstreamSubGroupSelection(L, uids, filterRef, min, max, nextIndex + 1, selected);
    if (found) return found;
    selected.pop();
  }
  return undefined;
}

function upstreamAuxGroupPredicateMatches(L: unknown, selectedUids: string[], allUids: string[], filterRef: number): boolean {
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushGroupTable(L, selectedUids);
  lua.lua_pushvalue(L, 2);
  lua.lua_pushvalue(L, 3);
  pushGroupTable(L, allUids);
  const status = lua.lua_pcall(L, 4, 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function pushFixedFilterWrapper(L: unknown, fieldName: string, readLuaError: (state: unknown) => string, requireFaceup: boolean, hostState?: LuaHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (!lua.lua_isfunction(state, 1)) {
      lua.lua_pushnil(state);
      return 1;
    }
    const extraArgCount = lua.lua_gettop(state) - 1;
    const refs: number[] = [];
    lua.lua_pushvalue(state, 1);
    refs.push(lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX));
    for (let index = 0; index < extraArgCount; index += 1) {
      lua.lua_pushvalue(state, index + 2);
      refs.push(lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX));
    }
    const descriptor = knownFixedFilterDescriptor(state, requireFaceup);
    lua.lua_pushjsfunction(state, (callState: unknown) => {
      if (requireFaceup && !isLuaCardFaceup(callState, readLuaError)) {
        lua.lua_pushboolean(callState, false);
        return 1;
      }
      const runtimeArgCount = lua.lua_gettop(callState);
      lua.lua_rawgeti(callState, lua.LUA_REGISTRYINDEX, refs[0]);
      if (runtimeArgCount > 0) lua.lua_pushvalue(callState, 1);
      for (let index = 1; index < refs.length; index += 1) lua.lua_rawgeti(callState, lua.LUA_REGISTRYINDEX, refs[index]);
      for (let index = 2; index <= runtimeArgCount; index += 1) lua.lua_pushvalue(callState, index);
      const status = lua.lua_pcall(callState, runtimeArgCount + refs.length - 1, 1, 0);
      if (status !== lua.LUA_OK) return lauxlib.luaL_error(callState, to_luastring(readLuaError(callState)));
      return 1;
    });
    if (descriptor !== undefined && hostState) {
      lua.lua_pushvalue(state, -1);
      hostState.functionDescriptors.set(lauxlib.luaL_ref(state, lua.LUA_REGISTRYINDEX), descriptor);
    }
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function knownFixedFilterDescriptor(L: unknown, requireFaceup: boolean): string | undefined {
  if (!lua.lua_isnumber(L, 2) || !isNamedTableFunction(L, 1, "Card", "IsType")) return undefined;
  const value = lua.lua_tointeger(L, 2);
  return `${requireFaceup ? "target:faceup-type" : "target:type"}:${value}`;
}

function isNamedTableFunction(L: unknown, index: number, tableName: string, fieldName: string): boolean {
  const absoluteIndex = lua.lua_absindex(L, index);
  lua.lua_getglobal(L, to_luastring(tableName));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return false;
  }
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  const same = Boolean(lua.lua_isfunction(L, -1) && lua.lua_rawequal(L, absoluteIndex, -1));
  lua.lua_pop(L, 2);
  return same;
}

function isLuaCardFaceup(L: unknown, readLuaError: (state: unknown) => string): boolean {
  if (!lua.lua_istable(L, 1)) return false;
  lua.lua_getfield(L, 1, to_luastring("IsFaceup"));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, 1);
    return false;
  }
  lua.lua_pushvalue(L, 1);
  const status = lua.lua_pcall(L, 1, 1, 0);
  if (status !== lua.LUA_OK) return Boolean(lauxlib.luaL_error(L, to_luastring(readLuaError(L))));
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}
