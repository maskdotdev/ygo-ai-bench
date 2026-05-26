import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installNeosReturnApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const source = `
    function aux.NeosReturnCondition1(e,tp,eg,ep,ev,re,r,rp)
      return not e:GetHandler():IsHasEffect(42015635)
    end
    function aux.NeosReturnCondition2(e,tp,eg,ep,ev,re,r,rp)
      return e:GetHandler():IsHasEffect(42015635)
    end
    function aux.NeosReturnTarget(c,extrainfo)
      return function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_TODECK,e:GetHandler(),1,0,0)
        if extrainfo then extrainfo(e,tp,eg,ep,ev,re,r,rp,chk) end
      end
    end
    function aux.NeosReturnSubstituteFilter(c)
      return c:IsCode(14088859) and c:IsAbleToRemoveAsCost()
    end
    function aux.NeosReturnOperation(c,extraop)
      return function(e,tp,eg,ep,ev,re,r,rp)
        local handler=e:GetHandler()
        if not handler:IsRelateToEffect(e) or handler:IsFacedown() then return end
        local sc=Duel.GetFirstMatchingCard(aux.NecroValleyFilter(aux.NeosReturnSubstituteFilter),tp,LOCATION_GRAVE,0,nil)
        if sc and Duel.SelectYesNo(tp,aux.Stringid(14088859,0)) then
          Duel.Remove(sc,POS_FACEUP,REASON_COST)
        else
          Duel.SendtoDeck(handler,nil,2,REASON_EFFECT)
        end
        if handler:IsLocation(LOCATION_EXTRA) and extraop then extraop(e,tp,eg,ep,ev,re,r,rp) end
      end
    end
    function aux.EnableNeosReturn(c,extracat,extrainfo,extraop,returneff)
      extracat=extracat or 0
      local e1=Effect.CreateEffect(c)
      e1:SetCategory(CATEGORY_TODECK+extracat)
      e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)
      e1:SetCode(EVENT_PHASE+PHASE_END)
      e1:SetRange(LOCATION_MZONE)
      e1:SetCountLimit(1)
      e1:SetCondition(aux.NeosReturnCondition1)
      e1:SetTarget(aux.NeosReturnTarget(c,extrainfo))
      e1:SetOperation(aux.NeosReturnOperation(c,extraop))
      c:RegisterEffect(e1)
      local e2=e1:Clone()
      e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)
      e2:SetProperty(0)
      e2:SetCondition(aux.NeosReturnCondition2)
      c:RegisterEffect(e2)
      if returneff then
        e1:SetLabelObject(returneff)
        e2:SetLabelObject(returneff)
      end
      return e1,e2
    end

    Auxiliary=Auxiliary or aux
    Auxiliary.EnableNeosReturn=aux.EnableNeosReturn
    Auxiliary.NeosReturnCondition1=aux.NeosReturnCondition1
    Auxiliary.NeosReturnCondition2=aux.NeosReturnCondition2
    Auxiliary.NeosReturnTarget=aux.NeosReturnTarget
    Auxiliary.NeosReturnOperation=aux.NeosReturnOperation
    Auxiliary.NeosReturnSubstituteFilter=aux.NeosReturnSubstituteFilter
  `;
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(source), source.length, to_luastring("neos-return.lua"));
  if (status !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) throw new Error(readLuaError(L));
}
