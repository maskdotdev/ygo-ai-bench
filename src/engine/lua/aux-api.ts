import fengari from "fengari";
import { pushCardTable } from "#lua/card-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import { readGroupUids, readOptionalFunctionRef, releaseOptionalFunctionRef } from "#lua/api-utils.js";
import type { DuelSession } from "#duel/types.js";

const { lua, lauxlib, to_luastring } = fengari;

export function installAuxApi(L: unknown, readLuaError: (state: unknown) => string, session?: DuelSession): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const code = lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 0;
    const index = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, code * 16 + index);
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
  pushFixedFilterWrapper(L, "FilterBoolFunctionEx", readLuaError, false);
  pushFixedFilterWrapper(L, "TargetBoolFunction", readLuaError, false);
  pushFixedFilterWrapper(L, "FaceupFilter", readLuaError, true);
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
  lua.lua_pushcfunction(L, (state: unknown) => pushAuxNext(state));
  lua.lua_setfield(L, -2, to_luastring("Next"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSpElimFilter(state, readLuaError));
  lua.lua_setfield(L, -2, to_luastring("SpElimFilter"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGlobalCheck(state, readLuaError));
  lua.lua_setfield(L, -2, to_luastring("GlobalCheck"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNecroValleyFilter(state, readLuaError));
  lua.lua_setfield(L, -2, to_luastring("NecroValleyFilter"));
  lua.lua_setglobal(L, to_luastring("aux"));
  installEquipProcedure(L, readLuaError);
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

function installEquipProcedure(L: unknown, readLuaError: (state: unknown) => string): void {
  const source = `
    local player_all_value = PLAYER_ALL or 2
    function aux.EquipLimit(f)
      return function(e,c)
        return not f or f(c,e,e:GetHandlerPlayer())
      end
    end
    function aux.EquipFilter(c,p,f,e,tp)
      return (p==player_all_value or c:IsControler(p)) and c:IsFaceup() and (not f or f(c,e,tp))
    end
    function aux.EquipTarget(tg,p,f)
      return function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        local player=nil
        if p==0 then
          player=tp
        elseif p==1 then
          player=1-tp
        elseif p==player_all_value or p==nil then
          player=player_all_value
        end
        if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsFaceup() and aux.EquipFilter(chkc,player,f,e,tp) end
        if chk==0 then return player~=nil and Duel.IsExistingTarget(aux.EquipFilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil,player,f,e,tp) end
        local g=Duel.SelectTarget(tp,aux.EquipFilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,player,f,e,tp)
        if tg then tg(e,tp,eg,ep,ev,re,r,rp,g:GetFirst()) end
        Duel.SetOperationInfo(0,CATEGORY_EQUIP,e:GetHandler(),1,0,0)
      end
    end
    function aux.EquipOperation(op)
      return function(e,tp,eg,ep,ev,re,r,rp)
        local tc=Duel.GetFirstTarget()
        if tc and tc:IsRelateToEffect(e) and tc:IsFaceup() then
          Duel.Equip(tp,e:GetHandler(),tc)
        end
        if op then op(e,tp,eg,ep,ev,re,r,rp) end
      end
    end
    function aux.AddEquipProcedure(c,p,f,eqlimit,cost,tg,op,con,prop)
      local property=prop or 0
      local e1=Effect.CreateEffect(c)
      e1:SetDescription(1068)
      e1:SetCategory(CATEGORY_EQUIP)
      e1:SetType(EFFECT_TYPE_ACTIVATE)
      e1:SetCode(EVENT_FREE_CHAIN)
      e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_CONTINUOUS_TARGET+property)
      if con then e1:SetCondition(con) end
      if cost then e1:SetCost(cost) end
      e1:SetTarget(aux.EquipTarget(tg,p,f))
      e1:SetOperation(aux.EquipOperation(op))
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetCode(EFFECT_EQUIP_LIMIT)
      e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      if eqlimit then
        e2:SetValue(eqlimit)
      else
        e2:SetValue(aux.EquipLimit(f))
      end
      c:RegisterEffect(e2)
      return e1
    end
    function aux.FilterMaximumSideFunction(f,...)
      local params={...}
      return function(target)
        return target:IsMaximumModeSide() and f(target,table.unpack(params))
      end
    end
    function aux.FilterMaximumSideFunctionEx(f,...)
      local params={...}
      return function(target)
        return ((not target:IsMaximumMode()) or (not (target:IsMaximumMode() and not target:IsMaximumModeCenter()))) and f(target,table.unpack(params))
      end
    end
    function aux.FilterEqualFunction(f,value,...)
      local params={...}
      return function(target)
        return f(target,table.unpack(params))==value
      end
    end
    function aux.FilterSummonCode(...)
      local params={...}
      return function(c,scard,sumtype,tp)
        return c:IsSummonCode(scard,sumtype,tp,table.unpack(params))
      end
    end
    function aux.sumlimit(sumtype)
      return function(e,se,sp,st)
        return (st & sumtype)==sumtype
      end
    end
    function aux.ritlimit(e,se,sp,st)
      return aux.sumlimit(SUMMON_TYPE_RITUAL)(e,se,sp,st)
    end
    function aux.fuslimit(e,se,sp,st)
      return aux.sumlimit(SUMMON_TYPE_FUSION)(e,se,sp,st)
    end
    function aux.synlimit(e,se,sp,st)
      return aux.sumlimit(SUMMON_TYPE_SYNCHRO)(e,se,sp,st)
    end
    function aux.xyzlimit(e,se,sp,st)
      return aux.sumlimit(SUMMON_TYPE_XYZ)(e,se,sp,st)
    end
    function aux.AND(...)
      local funs={...}
      return function(...)
        for _,f in ipairs(funs) do
          if not f(...) then return false end
        end
        return true
      end
    end
    function aux.NOT(f)
      return function(...)
        return not f(...)
      end
    end
    function aux.ChkfMMZ(sumcount)
      return function(sg,e,tp,mg)
        return Duel.GetMZoneCount(tp,sg)>=sumcount
      end
    end
    function aux.ReleaseCheckMMZ(sg,tp)
      return Duel.GetMZoneCount(tp,sg)>0
    end
    function aux.ReleaseCheckTarget(sg,tp,exg,dg)
      return dg and dg:IsExists(aux.TRUE,1,sg)
    end
    function aux.GetMustBeMaterialGroup(tp,eg,sump,sc,g,r)
      local effects={Duel.GetPlayerEffect(tp,EFFECT_MUST_BE_MATERIAL)}
      local sg=Group.CreateGroup()
      for _,te in ipairs(effects) do
        local value=te:GetValue()
        if type(value)=="function" then value=value(te,eg,sump,sc,g) end
        if value and (value & r)>0 then
          local handler=te:GetHandler()
          if handler then sg:AddCard(handler) end
        end
      end
      return sg
    end
    function aux.CheckStealEquip(c,e,tp)
      if c:IsFacedown() or not c:IsControlerCanBeChanged() or not c:IsControler(1-tp) then return false end
      if e:GetHandler():IsLocation(LOCATION_SZONE) then return true end
      if not Duel.IsDuelType(DUEL_TRAP_MONSTERS_NOT_USE_ZONE) and c:IsType(TYPE_TRAPMONSTER) then
        return Duel.GetLocationCount(tp,LOCATION_SZONE,tp,LOCATION_REASON_CONTROL)>0 and Duel.GetLocationCount(tp,LOCATION_SZONE,tp,0)>=2
      end
      return true
    end
    function aux.ChangeBattleDamage(player,value)
      return function(e,damp)
        if player==0 then
          if e:GetOwnerPlayer()==damp then return value end
          return -1
        elseif player==1 then
          if e:GetOwnerPlayer()==1-damp then return value end
          return -1
        end
      end
    end
    function aux.DefaultFieldReturnOp(ag,e,tp)
      local returned=0
      for tc in aux.Next(ag) do
        if Duel.ReturnToField(tc) then returned=returned+1 end
      end
      return returned
    end
    function aux.RemoveUntil(card_or_group,pos,reason,phase,flag,e,tp,oper,cond,reset,reset_count,hint,effect_desc)
      local g
      if type(card_or_group)=="table" and card_or_group.GetCount then
        g=card_or_group
      else
        g=Group.FromCards(card_or_group)
      end
      if pos==nil then pos=POS_FACEUP end
      if reason==nil then reason=REASON_EFFECT end
      local moved=Duel.Remove(g,pos,reason)
      if moved==0 then return false end
      return true
    end
    Auxiliary=Auxiliary or aux
  `;
  const status = lauxlib.luaL_dostring(L, to_luastring(source));
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
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
  const min = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1;
  const max = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : min;
  const filterRef = readOptionalFunctionRef(L, 7);
  const selected = filterRef === undefined ? selectGroupUids(uids, min, max) : selectSubGroup(L, uids, filterRef, min, max, 8) ?? [];
  releaseOptionalFunctionRef(L, filterRef);
  pushGroupTable(L, selected);
  return 1;
}

function selectGroupUids(uids: string[], min: number, max: number): string[] {
  const boundedMin = Math.max(0, min);
  if (uids.length < boundedMin) return [];
  const limit = max > 0 ? Math.max(boundedMin, max) : uids.length;
  return uids.slice(0, limit);
}

function selectSubGroup(L: unknown, uids: string[], filterRef: number, min: number, max: number, argsStart: number): string[] | undefined {
  const boundedMin = Math.max(0, min);
  const boundedMax = Math.max(boundedMin, max > 0 ? max : uids.length);
  return findSubGroupSelection(L, uids, filterRef, boundedMin, boundedMax, argsStart, 0, []);
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

function pushFixedFilterWrapper(L: unknown, fieldName: string, readLuaError: (state: unknown) => string, requireFaceup: boolean): void {
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
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
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
