import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installEquipProcedureApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const source = `
    local player_all_value = PLAYER_ALL or 3
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
        if p==0 then player=tp
        elseif p==1 then player=1-tp
        elseif p==player_all_value or p==nil then player=player_all_value end
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
        if tc and tc:IsRelateToEffect(e) and tc:IsFaceup() then Duel.Equip(tp,e:GetHandler(),tc) end
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
      if eqlimit then e2:SetValue(eqlimit)
      else e2:SetValue(aux.EquipLimit(f)) end
      c:RegisterEffect(e2)
      return e1
    end
    function aux.EquipAndLimitRegister(c,e,tp,tc,code,previousPos)
      if not tc:EquipByEffectAndLimitRegister(e,tp,c,code,previousPos==nil and true or previousPos) then return false end
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(EFFECT_EQUIP_LIMIT)
      e1:SetReset(RESET_EVENT+RESETS_STANDARD)
      e1:SetValue(function(le,ec) return ec==tc end)
      c:RegisterEffect(e1)
      return true
    end
    function aux.AddEREquipLimit(c,con,equipval,equipop,linkedeff,prop,resetflag,resetcount)
      local finalprop=EFFECT_FLAG_CANNOT_DISABLE
      if prop then finalprop=finalprop|prop end
      local e1=Effect.CreateEffect(c)
      if con then e1:SetCondition(con) end
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(finalprop)
      e1:SetCode(89785779)
      e1:SetLabelObject(linkedeff)
      if resetflag and resetcount then e1:SetReset(resetflag,resetcount)
      elseif resetflag then e1:SetReset(resetflag) end
      e1:SetValue(function(ec,bc,tp) return equipval(ec,bc,tp) end)
      e1:SetOperation(function(ec,e,tp,tc) return equipop(ec,e,tp,tc) end)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(finalprop & ~EFFECT_FLAG_CANNOT_DISABLE)
      e2:SetCode(89785779+EFFECT_EQUIP_LIMIT)
      if resetflag and resetcount then e2:SetReset(resetflag,resetcount)
      elseif resetflag then e2:SetReset(resetflag) end
      c:RegisterEffect(e2)
      if linkedeff then linkedeff:SetLabelObject(e2) end
      return e1,e2
    end
    function aux.ZWEquipLimit(tc,te)
      return function(e,c)
        if c~=tc then return false end
        if not te then return true end
        local effects={e:GetHandler():GetCardEffect(75402014+EFFECT_EQUIP_LIMIT)}
        for _,eff in ipairs(effects) do
          if eff==te then return true end
        end
        return false
      end
    end
    function aux.AddZWEquipLimit(c,con,equipval,equipop,linkedeff,prop,resetflag,resetcount)
      local finalprop=EFFECT_FLAG_CANNOT_DISABLE
      if prop then finalprop=finalprop|prop end
      local e1=Effect.CreateEffect(c)
      if con then e1:SetCondition(con) end
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(finalprop)
      e1:SetCode(75402014)
      e1:SetLabelObject(linkedeff)
      if resetflag and resetcount then e1:SetReset(resetflag,resetcount)
      elseif resetflag then e1:SetReset(resetflag) end
      e1:SetValue(function(ec,bc,tp) return equipval(ec,bc,tp) end)
      e1:SetOperation(function(ec,e,tp,tc) return equipop(ec,e,tp,tc) end)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(finalprop & ~EFFECT_FLAG_CANNOT_DISABLE)
      e2:SetCode(75402014+EFFECT_EQUIP_LIMIT)
      if resetflag and resetcount then e2:SetReset(resetflag,resetcount)
      elseif resetflag then e2:SetReset(resetflag) end
      c:RegisterEffect(e2)
      if linkedeff then linkedeff:SetLabelObject(e2) end
      return e1,e2
    end

    Auxiliary=Auxiliary or aux
    Auxiliary.EquipAndLimitRegister=aux.EquipAndLimitRegister
    Auxiliary.AddEREquipLimit=aux.AddEREquipLimit
    Auxiliary.AddZWEquipLimit=aux.AddZWEquipLimit
  `;
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(source), source.length, to_luastring("equip-procedure.lua"));
  if (status !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) throw new Error(readLuaError(L));
}
