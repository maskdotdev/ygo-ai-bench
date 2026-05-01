import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installEffectCompatibilityApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const source = `
    function Effect.CreateMysteruneQPEffect(c,id,uniquecat,uniquetg,uniqueop,rmcount,uniqueprop,uniquecode)
      uniquecat=uniquecat or 0
      rmcount=rmcount or 0
      local function apply_unique(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        if chkc then return uniquetg and uniquetg(e,tp,eg,ep,ev,re,r,rp,chk,chkc) end
        if chk==0 then return not uniquetg or uniquetg(e,tp,eg,ep,ev,re,r,rp,0) end
        if uniqueprop then e:SetProperty(uniqueprop) end
        e:SetCategory(uniquecat|CATEGORY_REMOVE)
        if uniquetg then uniquetg(e,tp,eg,ep,ev,re,r,rp,1) end
      end
      local function apply_operation(e,tp,eg,ep,ev,re,r,rp)
        if uniqueop then return uniqueop(e,tp,eg,ep,ev,re,r,rp) end
        return true
      end
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_ACTIVATE)
      e1:SetCode(EVENT_FREE_CHAIN)
      e1:SetHintTiming(0,TIMINGS_CHECK_MONSTER+TIMING_END_PHASE)
      e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)
      if uniquecode then
        local e0=Effect.CreateEffect(c)
        e0:SetDescription(aux.Stringid(id,0))
        e0:SetCategory(uniquecat|CATEGORY_REMOVE)
        e0:SetType(EFFECT_TYPE_ACTIVATE)
        e0:SetCode(uniquecode)
        e0:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)
        if uniqueprop then e0:SetProperty(uniqueprop) end
        e0:SetTarget(apply_unique)
        e0:SetOperation(apply_operation)
        e1:SetDescription(aux.Stringid(id,1))
        e1:SetCategory(CATEGORY_SPECIAL_SUMMON)
        e1:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk) return chk~=0 or true end)
        e1:SetOperation(function() return true end)
        return e0,e1
      end
      e1:SetTarget(apply_unique)
      e1:SetOperation(apply_operation)
      return e1
    end
    function Effect.HasRemainFieldCost(e)
      return e:GetCost()==aux.RemainFieldCost
    end
    function Effect.HasDetachCost(e)
      local cost=e:GetCost()
      return cost~=nil and __duel_detach_costs~=nil and __duel_detach_costs[cost] or false
    end
    local create_effect,global_effect=Effect.CreateEffect,Effect.GlobalEffect
    function Effect.CreateEffect(c) return setmetatable(create_effect(c),{__index=Effect}) end
    function Effect.GlobalEffect() return setmetatable(global_effect(),{__index=Effect}) end
  `;
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(source), source.length, to_luastring("effect-compat.lua"));
  if (status !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) throw new Error(readLuaError(L));
}
