import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installMaleficApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const source = `
    SET_MALEFIC = SET_MALEFIC or 0x23

    function aux.MaleficUniqueFilter(cc)
      local mt=cc:GetMetatable()
      mt.has_malefic_unique=mt.has_malefic_unique or {}
      mt.has_malefic_unique[cc]=true
      return function(c)
        return not Duel.IsPlayerAffectedByEffect(c:GetControler(),75223115) and c:IsSetCard(SET_MALEFIC)
      end
    end
    function aux.MaleficSummonFilter(c,cd)
      return ((cd and c:IsCode(cd)) or ((not cd) and c:IsSetCard(SET_MALEFIC))) and c:IsAbleToRemoveAsCost()
    end
    function aux.MaleficSummonSubstitute(c,cd,tp)
      return c:IsHasEffect(48829461,tp) and c:IsAbleToRemoveAsCost()
    end
    function aux.MaleficSummonCondition(cd,loc,excon)
      return function(e,c)
        if excon and not excon(e,c) then return false end
        if c==nil then return true end
        local tp=c:GetControler()
        return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
          and (Duel.IsExistingMatchingCard(aux.MaleficSummonFilter,tp,loc,0,1,nil,cd)
            or Duel.IsExistingMatchingCard(aux.MaleficSummonSubstitute,tp,LOCATION_ONFIELD+LOCATION_GRAVE,0,1,nil,cd,tp))
      end
    end
    function aux.MaleficSummonTarget(cd,loc)
      return function(e,tp,eg,ep,ev,re,r,rp,chk,c)
        local g=Duel.GetMatchingGroup(aux.MaleficSummonFilter,tp,loc,0,nil,cd)
        g:Merge(Duel.GetMatchingGroup(aux.MaleficSummonSubstitute,tp,LOCATION_ONFIELD+LOCATION_GRAVE,0,nil,cd,tp))
        local sg=aux.SelectUnselectGroup(g,e,tp,1,1,aux.ChkfMMZ(1),1,tp,HINTMSG_REMOVE,nil,nil,true)
        if sg:GetCount()>0 then
          sg:KeepAlive()
          e:SetLabelObject(sg)
          return true
        end
        return false
      end
    end
    function aux.MaleficSummonOperation(cd,loc)
      return function(e,tp,eg,ep,ev,re,r,rp,c)
        local g=e:GetLabelObject()
        if not g then return end
        local tc=g:GetFirst()
        if not tc then return end
        local substitute=tc:IsHasEffect(48829461,tp)
        if substitute then substitute:UseCountLimit(tp) end
        Duel.Remove(tc,POS_FACEUP,REASON_COST)
        g:DeleteGroup()
      end
    end
    function aux.AddMaleficSummonProcedure(c,code,loc,excon)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(EFFECT_SPSUMMON_PROC)
      e1:SetProperty(EFFECT_FLAG_UNCOPYABLE)
      e1:SetRange(LOCATION_HAND)
      e1:SetCondition(aux.MaleficSummonCondition(code,loc,excon))
      e1:SetTarget(aux.MaleficSummonTarget(code,loc))
      e1:SetOperation(aux.MaleficSummonOperation(code,loc))
      c:RegisterEffect(e1)
      return e1
    end

    Auxiliary=Auxiliary or aux
    Auxiliary.MaleficUniqueFilter=aux.MaleficUniqueFilter
    Auxiliary.AddMaleficSummonProcedure=aux.AddMaleficSummonProcedure
  `;
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(source), source.length, to_luastring("malefic.lua"));
  if (status !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) throw new Error(readLuaError(L));
}
