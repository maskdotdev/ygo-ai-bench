import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installAuxUtilityApi(L: unknown, readLuaError: (state: unknown) => string): void {
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
    function aux.RemainFieldCost(e,tp,eg,ep,ev,re,r,rp,chk)
      return chk==0 or true
    end
    local set_amazement = SET_AMAZEMENT or 0x15e
    local set_attraction = SET_ATTRACTION or 0x15f
    AA = AA or {}
    function AA.eqtgfilter(c,tp)
      return c:IsFaceup() and (c:IsSetCard(set_amazement) or (not c:IsControler(tp)))
    end
    function AA.eqtg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      if chkc then return chkc:IsLocation(LOCATION_MZONE) and AA.eqtgfilter(chkc,tp) end
      if chk==0 then
        return e:IsHasType(EFFECT_TYPE_ACTIVATE) and Duel.IsExistingTarget(AA.eqtgfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil,tp)
      end
      Duel.SelectTarget(tp,AA.eqtgfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,tp)
      Duel.SetOperationInfo(0,CATEGORY_EQUIP,e:GetHandler(),1,0,0)
    end
    function AA.eqlim(e,c)
      return c:GetControler()==e:GetHandlerPlayer() or e:GetHandler():GetEquipTarget()==c
    end
    function AA.eqop(e,tp,eg,ep,ev,re,r,rp)
      local c=e:GetHandler()
      if (not c:IsLocation(LOCATION_SZONE)) or (not c:IsRelateToEffect(e)) or c:IsStatus(STATUS_LEAVE_CONFIRMED) then return end
      local tc=Duel.GetFirstTarget()
      if tc and tc:IsRelateToEffect(e) and tc:IsFaceup() then
        Duel.Equip(tp,c,tc)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_SINGLE)
        e1:SetCode(EFFECT_EQUIP_LIMIT)
        e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
        e1:SetValue(AA.eqlim)
        e1:SetReset(RESET_EVENT|RESETS_STANDARD)
        c:RegisterEffect(e1)
      elseif c.CancelToGrave then
        c:CancelToGrave(false)
      end
    end
    function aux.AddAttractionEquipProc(c)
      local e1=Effect.CreateEffect(c)
      e1:SetCategory(CATEGORY_EQUIP)
      e1:SetType(EFFECT_TYPE_ACTIVATE)
      e1:SetCode(EVENT_FREE_CHAIN)
      e1:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e1:SetCost(aux.RemainFieldCost)
      e1:SetTarget(AA.eqtg)
      e1:SetOperation(AA.eqop)
      c:RegisterEffect(e1)
      return e1
    end
    function aux.AttractionEquipCon(self)
      return function(e)
        local et=e:GetHandler():GetEquipTarget()
        return et and (et:GetControler()==e:GetHandlerPlayer())==self
      end
    end
    function aux.StatChangeDamageStepCondition()
      return not Duel.IsDamageCalculated()
    end
    function aux.damcon1(e,tp,eg,ep,ev,re,r,rp)
      local e1=Duel.IsPlayerAffectedByEffect(tp,EFFECT_REVERSE_DAMAGE)
      local e2=Duel.IsPlayerAffectedByEffect(tp,EFFECT_REVERSE_RECOVER)
      local rd=e1 and not e2
      local rr=(not e1) and e2
      local ex,cat,cg,ct,cp,cv=Duel.GetOperationInfo(ev,CATEGORY_DAMAGE)
      if ex and (cp==tp or cp==PLAYER_ALL) and not rd and not Duel.IsPlayerAffectedByEffect(tp,EFFECT_NO_EFFECT_DAMAGE) then
        return true
      end
      ex,cat,cg,ct,cp,cv=Duel.GetOperationInfo(ev,CATEGORY_RECOVER)
      return ex and (cp==tp or cp==PLAYER_ALL) and rr and not Duel.IsPlayerAffectedByEffect(tp,EFFECT_NO_EFFECT_DAMAGE)
    end
    function aux.thoeSend(card)
      return Duel.SendtoGrave(card,REASON_EFFECT)
    end
    function aux.ToHandOrElse(card,player,check,oper,str,...)
      if not card then return nil end
      if not check then check=Card.IsAbleToGrave end
      if not oper then oper=aux.thoeSend end
      if not str then str=574 end
      local params={...}
      local b1,b2=true,true
      if type(card)=="table" and card.GetCount then
        for ctg in aux.Next(card) do
          if not ctg:IsAbleToHand() then b1=false end
          if not check(ctg,table.unpack(params)) then b2=false end
        end
      else
        b1=card:IsAbleToHand()
        b2=check(card,table.unpack(params))
      end
      if not b1 and not b2 then return 0 end
      local opt=0
      if b1 and b2 then
        opt=Duel.SelectOption(player,573,str)
      elseif not b1 then
        opt=Duel.SelectOption(player,str)+1
      end
      if opt==0 then
        local res=Duel.SendtoHand(card,nil,REASON_EFFECT)
        if res~=0 then Duel.ConfirmCards(1-player,card) end
        return res
      end
      return oper(card,table.unpack(params))
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
    function aux.FilterBoolFunctionEx2(f,...)
      local params={...}
      return function(target,scard,sumtype,tp)
        return f(target,scard,sumtype,tp,table.unpack(params))
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
    function aux.qlifilter(e,te)
      if te:IsActiveType(TYPE_MONSTER) and te:IsActivated() then
        local lv=e:GetHandler():GetLevel()
        local ec=te:GetOwner()
        if ec:IsType(TYPE_LINK) then
          return false
        elseif ec:IsType(TYPE_XYZ) then
          return ec:GetOriginalRank()<lv
        else
          return ec:GetOriginalLevel()<lv
        end
      end
      return false
    end
    function aux.gbspcon(e,tp,eg,ep,ev,re,r,rp)
      local st=e:GetHandler():GetSummonType()
      return st>=SUMMON_TYPE_SPECIAL+100 and st<SUMMON_TYPE_SPECIAL+150
    end
    function aux.evospcon(e,tp,eg,ep,ev,re,r,rp)
      local st=e:GetHandler():GetSummonType()
      return st>=SUMMON_TYPE_SPECIAL+150 and st<SUMMON_TYPE_SPECIAL+180
    end
    function aux.seqmovcon(e,tp,eg,ep,ev,re,r,rp)
      return e:GetHandler():CheckAdjacent()
    end
    function aux.tgoval(e,re,rp)
      return rp~=e:GetHandlerPlayer()
    end
    function aux.indsval(e,re,rp)
      return rp==e:GetHandlerPlayer()
    end
    function aux.indoval(e,re,rp)
      return rp==1-e:GetHandlerPlayer()
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
    local card_dark_fusion = CARD_DARK_FUSION or 94820406
    local card_super_polymerization = CARD_SUPER_POLYMERIZATION or 48130397
    local skill_dark_unity = SKILL_DARK_UNITY or 300306009
    local effect_supreme_castle = EFFECT_SUPREME_CASTLE or 72043279
    function aux.EvilHeroLimit(e,se,sp,st)
      local handler = se and se.GetHandler and se:GetHandler() or nil
      if handler and handler:IsCode(card_dark_fusion) then return true end
      local player = e and e.GetHandlerPlayer and e:GetHandlerPlayer() or 0
      if handler and Duel.IsPlayerAffectedByEffect(player, skill_dark_unity) and handler:IsCode(card_super_polymerization) then return true end
      return Duel.IsPlayerAffectedByEffect(player, effect_supreme_castle) and ((st or 0) & SUMMON_TYPE_FUSION)==SUMMON_TYPE_FUSION
    end
    local card_fossil_fusion = CARD_FOSSIL_FUSION or 59419719
    function aux.FossilLimit(e,se,sp,st)
      local summon_card = e and e.GetHandler and e:GetHandler() or nil
      if not summon_card or not summon_card:IsLocation(LOCATION_EXTRA) then return true end
      local handler = se and se.GetHandler and se:GetHandler() or nil
      return handler and handler:IsCode(card_fossil_fusion)
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
    function aux.OR(...)
      local funs={...}
      return function(...)
        for _,f in ipairs(funs) do
          if f(...) then return true end
        end
        return false
      end
    end
    function aux.GetCoinEffectHintString(coin)
      if coin==COIN_HEADS then return 62 end
      if coin==COIN_TAILS then return 63 end
      return nil
    end
    function aux.FieldSummonProcTg(fun1,fun2)
      return function(e,tp,eg,ep,ev,re,r,rp,chk,c,...)
        if not c then
          return not fun1 or fun1(e,tp)
        end
        return not fun2 or fun2(e,tp,eg,ep,ev,re,r,rp,chk,c,...)
      end
    end
    function aux.ValuesReset()
      if not aux.ToResetFuncTable then return false end
      for _,resetfunc in pairs(aux.ToResetFuncTable) do
        resetfunc()
      end
      return false
    end
    function aux.AddValuesReset(resetfunc)
      if not resetfunc then return nil end
      if not aux.ToResetFuncTable then
        aux.ToResetFuncTable={resetfunc}
        local ge=Effect.GlobalEffect()
        ge:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        ge:SetCode(EVENT_TURN_END)
        ge:SetCountLimit(1)
        ge:SetCondition(aux.ValuesReset)
        Duel.RegisterEffect(ge,0)
        return ge
      end
      table.insert(aux.ToResetFuncTable,resetfunc)
      return nil
    end
    local function get_multi(tab,key,...)
      if not key then return nil end
      return (tab[key]~=nil and tab[key]) or get_multi(tab,...)
    end
    function aux.ParamsFromTable(tab,key,...)
      if key then
        local val
        if type(key)=="table" then val=get_multi(tab,table.unpack(key)) else val=tab[key] end
        if ... then return val,aux.ParamsFromTable(tab,...) end
        if key=="vaargs" and type(val)=="table" then return table.unpack(val) end
        return val
      end
    end
    function aux.FunctionWithNamedArgs(f,...)
      local args={...}
      return function(tab,...)
        if type(tab)=="table" then return f(aux.ParamsFromTable(tab,table.unpack(args))) end
        return f(tab,...)
      end
    end
    function aux.cannotmatfilter(val1,...)
      local allowed=val1
      if type(val1)~="table" then allowed={val1,...} end
      local total=0
      for _,val in pairs(allowed) do
        total=total|val
      end
      return function(e,c,sumtype,tp)
        local sum=total&sumtype
        for _,val in pairs(allowed) do
          if sum==val then return true end
        end
        return false
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
    function aux.dpcheck(fun)
      return function(sg,e,tp,mg)
        local c1=sg:GetClassCount(fun)
        local c2=sg:GetCount()
        return c1==c2,c1~=c2
      end
    end
    function aux.dncheck(sg,e,tp,mg)
      return aux.dpcheck(Card.GetCode)(sg,e,tp,mg)
    end
    function aux.exccon(e)
      return Duel.GetTurnCount()~=e:GetHandler():GetTurnID() or e:GetHandler():IsReason(REASON_RETURN)
    end
    function aux.imval1(e,c)
      return not c:IsImmuneToEffect(e)
    end
    function aux.imval2(e,c)
      return aux.imval1(e,c) and c:GetControler()~=e:GetHandlerPlayer()
    end
    function aux.chainreg(e,tp,eg,ep,ev,re,r,rp)
      if e:GetHandler():GetFlagEffect(1)==0 then
        e:GetHandler():RegisterFlagEffect(1,RESET_EVENT+RESETS_STANDARD-RESET_TURN_SET+RESET_CHAIN,0,1)
      end
    end
    function aux.sumreg(e,tp,eg,ep,ev,re,r,rp)
      local code=e:GetLabel()
      for tc in aux.Next(eg) do
        if tc:GetOriginalCode()==code then
          tc:RegisterFlagEffect(code,RESETS_STANDARD_PHASE_END,0,1)
        end
      end
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
    function aux.RegisterClientHint(card,property,tp,player1,player2,str,reset,ct)
      if not card then return nil end
      local eff=Effect.CreateEffect(card)
      eff:SetProperty(EFFECT_FLAG_PLAYER_TARGET | EFFECT_FLAG_CLIENT_HINT | (property or 0))
      eff:SetTargetRange(player1 or 0,player2 or 0)
      eff:SetDescription(str or aux.Stringid(card:GetOriginalCode(),1))
      eff:SetReset(RESET_PHASE | PHASE_END | (reset or 0),ct or 1)
      Duel.RegisterEffect(eff,tp or 0)
      return eff
    end
    function aux.EnableExtraRulesOperation(card,init,...)
      local args={...}
      return function(e,tp,eg,ep,ev,re,r,rp)
        if card then card.global_active_check=true end
        if init then return init(e:GetOwner(),table.unpack(args)) end
      end
    end
    function aux.EnableExtraRules(c,card,init,...)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
      e1:SetCode(EVENT_ADJUST)
      e1:SetProperty(EFFECT_FLAG_UNCOPYABLE|EFFECT_FLAG_CANNOT_DISABLE)
      e1:SetOperation(aux.EnableExtraRulesOperation(card,init,...))
      Duel.RegisterEffect(e1,0)
      return e1
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
