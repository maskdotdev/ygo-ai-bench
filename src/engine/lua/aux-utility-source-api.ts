export const auxUtilitySource = `
    Auxiliary=Auxiliary or aux
    function aux.IsGroupObject(value)
      return type(value)=="Group" or (type(value)=="table" and value.GetCount)
    end
    function aux.NULL()
    end
    function Auxiliary.addLizardCheck(c)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(CARD_CLOCK_LIZARD or 51476410)
      e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e1:SetValue(1)
      c:RegisterEffect(e1)
      return e1
    end
    aux.addLizardCheck=Auxiliary.addLizardCheck
    aux.RitualSummoningLevel=nil
    function aux.dogcon(e,tp,eg,ep,ev,re,r,rp)
      local c=e:GetHandler()
      return c:IsPreviousControler(tp) and c:IsReason(REASON_DESTROY) and rp==1-tp
    end
    function aux.DoubleTributeCon(e,tp,eg,ep,ev,re,r,rp)
      return not Duel.IsPlayerAffectedByEffect(tp,FLAG_NO_TRIBUTE)
    end
    function aux.LavaCheck(sg,e,tp,mg)
      return Duel.GetMZoneCount(1-tp,sg,tp)>0
    end
    function aux.LavaCondition(required,filter)
      return function(e,c)
        if c==nil then return true end
        local tp=c:GetControler()
        local mg=Duel.GetMatchingGroup(aux.AND(Card.IsReleasable,filter),tp,0,LOCATION_MZONE,nil)
        local sg=aux.SelectUnselectGroup(mg,e,tp,required,required,aux.LavaCheck,0)
        return aux.IsGroupObject(sg) and sg:GetCount()>0 or sg
      end
    end
    function aux.RemainFieldCost(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return true end
      local c=e:GetHandler()
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(EFFECT_REMAIN_FIELD)
      e1:SetProperty(EFFECT_FLAG_OATH)
      e1:SetReset(RESET_CHAIN)
      c:RegisterEffect(e1)
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
      local ex,cg,ct,cp,cv=Duel.GetOperationInfo(ev,CATEGORY_DAMAGE)
      if ex and (cp==tp or cp==PLAYER_ALL) and not rd and not Duel.IsPlayerAffectedByEffect(tp,EFFECT_NO_EFFECT_DAMAGE) then
        return true
      end
      ex,cg,ct,cp,cv=Duel.GetOperationInfo(ev,CATEGORY_RECOVER)
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
      if aux.IsGroupObject(card) then
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
    function aux.seqmovop(e,tp,eg,ep,ev,re,r,rp)
      local c=e:GetHandler()
      if not c:IsRelateToEffect(e) or c:IsControler(1-tp) then return end
      c:MoveAdjacent(tp)
    end
    function aux.seqmovtg(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return true end
      e:SetLabel(e:GetHandler():SelectAdjacent(tp))
    end
    function aux.seqmovtgop(e,tp,eg,ep,ev,re,r,rp)
      local c=e:GetHandler()
      local seq=e:GetLabel()
      if not c:IsRelateToEffect(e) or c:IsControler(1-tp) or not Duel.CheckLocation(tp,LOCATION_MZONE,seq) then return end
      Duel.MoveSequence(c,seq)
    end
    function aux.ReleaseCostFilter(c,tp)
      local eff=c:IsHasEffect(EFFECT_EXTRA_RELEASE_NONSUM)
      return not (c:IsControler(1-tp) and eff and eff.CheckCountLimit and eff:CheckCountLimit(tp)) and not c:IsHasEffect(EFFECT_EXTRA_RELEASE)
    end
    function aux.ReleaseNonSumCheck(c,tp,e)
      if c:IsControler(tp) then return false end
      local chk=false
      for _,eff in ipairs({c:GetCardEffect(EFFECT_EXTRA_RELEASE_NONSUM)}) do
        local val=eff:GetValue()
        if type(val)=="number" then chk=val~=0
        else chk=val(eff,e,REASON_COST,tp) end
        if chk then return true end
      end
      return chk
    end
    function aux.IceBarrierDiscardFilter(c,tp)
      local eff=c:IsHasEffect(EFFECT_ICEBARRIER_REPLACE)
      return c:IsLocation(LOCATION_GRAVE) and eff and eff:CheckCountLimit(tp)
    end
    function aux.IceBarrierDiscardCost(f,discard,minc,maxc)
      local filter=discard and Card.IsDiscardable or Card.IsAbleToGraveAsCost
      if f then filter=aux.AND(f,filter) end
      minc=minc or 1
      maxc=maxc or 1
      return function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then
          return Duel.IsExistingMatchingCard(filter,tp,LOCATION_HAND,0,minc,nil)
            or Duel.IsExistingMatchingCard(aux.IceBarrierDiscardFilter,tp,LOCATION_GRAVE,0,1,nil,tp)
        end
        local g=Duel.GetMatchingGroup(filter,tp,LOCATION_HAND,0,nil)
        g:Merge(Duel.GetMatchingGroup(aux.IceBarrierDiscardFilter,tp,LOCATION_GRAVE,0,nil,tp))
        local sg=g:Select(tp,minc,maxc)
        local repl=sg:Filter(Card.IsHasEffect,nil,EFFECT_ICEBARRIER_REPLACE,tp)
        local rm=0
        if repl:GetCount()>0 then
          repl:GetFirst():IsHasEffect(EFFECT_ICEBARRIER_REPLACE):UseCountLimit(tp)
          rm=Duel.Remove(repl,POS_FACEUP,REASON_COST)
          sg:Sub(repl)
        end
        if sg:GetCount()==0 then return rm end
        local reason=discard and (REASON_COST+REASON_DISCARD) or REASON_COST
        return Duel.SendtoGrave(sg,reason)+rm
      end
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
    function aux.penlimit(e,se,sp,st)
      return aux.sumlimit(SUMMON_TYPE_PENDULUM)(e,se,sp,st)
    end
    function aux.lnklimit(e,se,sp,st)
      return aux.sumlimit(SUMMON_TYPE_LINK)(e,se,sp,st)
    end
    function aux.fusfirstlimit(e,se,sp,st)
      return not e:GetHandler():IsLocation(LOCATION_EXTRA) or (st & SUMMON_TYPE_FUSION)==SUMMON_TYPE_FUSION
    end
    function aux.ritfirstlimit(e,se,sp,st)
      return e:GetHandler():IsStatus(STATUS_PROC_COMPLETE) or (st & SUMMON_TYPE_RITUAL)==SUMMON_TYPE_RITUAL
    end
    function aux.synfirstlimit(e,se,sp,st)
      return not e:GetHandler():IsLocation(LOCATION_EXTRA) or (st & SUMMON_TYPE_SYNCHRO)==SUMMON_TYPE_SYNCHRO
    end
    function aux.xyzfirstlimit(e,se,sp,st)
      return not e:GetHandler():IsLocation(LOCATION_EXTRA) or (st & SUMMON_TYPE_XYZ)==SUMMON_TYPE_XYZ
    end
    function aux.penfirstlimit(e,se,sp,st)
      return e:GetHandler():IsStatus(STATUS_PROC_COMPLETE) or (st & SUMMON_TYPE_PENDULUM)==SUMMON_TYPE_PENDULUM
    end
    function aux.lnkfirstlimit(e,se,sp,st)
      return not e:GetHandler():IsLocation(LOCATION_EXTRA) or (st & SUMMON_TYPE_LINK)==SUMMON_TYPE_LINK
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
    function aux.GetCoinCountFromEv(ev)
      return (ev or 0) & 0xff
    end
    function aux.GetCoinHeadsFromEv(ev)
      return ((ev or 0) >> 8) & 0xff
    end
    function aux.GetCoinTailsFromEv(ev)
      return ((ev or 0) >> 16) & 0xff
    end
    function aux.GetDiceCountSelfFromEv(ev)
      return (ev or 0) & 0xffff
    end
    function aux.GetDiceCountOppoFromEv(ev)
      return ((ev or 0) >> 16) & 0xffff
    end
    function aux.ComposeNumberDigitByDigit(tp,min,max)
      local low=math.min(min or 0,max or min or 0)
      local high=math.max(min or 0,max or min or 0)
      return Duel.AnnounceNumberRange(tp,low,high)
    end
    function aux.GrouptoCardid(g)
      local res={}
      for card in aux.Next(g) do
        res[card:GetCardID()]=true
      end
      return res
    end
    function aux.GetExtraMaterials(tp,mustg,sc,summon_type)
      local tg=Group.CreateGroup()
      mustg=mustg or Group.CreateGroup()
      local entries={}
      for _,te in ipairs({Duel.GetPlayerEffect(tp,EFFECT_EXTRA_MATERIAL)}) do
        if te:CheckCountLimit(tp) then
          local val=te:GetValue()
          local eg=type(val)=="function" and val(0,summon_type,te,tp,sc) or Group.CreateGroup()
          eg:Sub(mustg)
          eg:KeepAlive()
          tg:Merge(eg)
          table.insert(entries,{eg,te:GetOperation() or aux.TRUE,te})
        end
      end
      return entries,tg
    end
    function aux.CheckValidExtra(c,tp,sg,mg,lc,emt,filt)
      local res=false
      filt=filt or {}
      for _,ex in ipairs(emt or {}) do
        if ex[1]:IsContains(c) and ex[2](c,ex[3],tp,sg,mg,lc,ex[1],0) then
          res=true
          table.insert(filt,ex)
        end
      end
      return res
    end
    function aux.DeleteExtraMaterialGroups(emt)
      for _,ex in ipairs(emt or {}) do
        local val=ex[3]:GetValue()
        if type(val)=="function" then val(2,nil,ex[3],ex[1]) end
        ex[1]:DeleteGroup()
      end
    end
    function aux.BitSplit(v)
      local res={}
      local i=0
      while 2^i<=v do
        local p=2^i
        if v & p~=0 then table.insert(res,p) end
        i=i+1
      end
      return pairs(res)
    end
    function aux.GetAttributeStrings(v)
      local t={
        [ATTRIBUTE_EARTH]=1010,
        [ATTRIBUTE_WATER]=1011,
        [ATTRIBUTE_FIRE]=1012,
        [ATTRIBUTE_WIND]=1013,
        [ATTRIBUTE_LIGHT]=1014,
        [ATTRIBUTE_DARK]=1015,
        [ATTRIBUTE_DIVINE]=1016
      }
      local res={}
      for _,att in aux.BitSplit(v) do
        if t[att] then table.insert(res,t[att]) end
      end
      return pairs(res)
    end
    function aux.PropertyTableFilter(f,...)
      local cachetab={}
      local truthtable={}
      for _,elem in pairs({...}) do
        truthtable[elem]=true
      end
      return function(c,...)
        if not cachetab[c] then
          cachetab[c]={}
          for _,val in pairs({f(c,...)}) do
            if truthtable[val] then table.insert(cachetab[c],val) end
          end
        end
        return table.unpack(cachetab[c])
      end
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
        if type(tab)=="table" and tab.__duel_uid==nil then return f(aux.ParamsFromTable(tab,table.unpack(args))) end
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
    function aux.ZoneCheckFunc(c,tp,zone)
      if c:IsLocation(LOCATION_EXTRA) then
        return function(sg) return Duel.GetLocationCountFromEx(tp,tp,sg,c) end
      end
      return function(sg) return Duel.GetMZoneCount(tp,sg,zone) end
    end
    local function link_card_filter(c,f,...)
      return c:IsFaceup() and c:IsType(TYPE_LINK) and (not f or f(c,...))
    end
    function aux.GetMMZonesPointedTo(player,by_filter,player_location,oppo_location,target_player,...)
      local loc1=player_location==nil and LOCATION_MZONE or player_location
      local loc2=oppo_location==nil and loc1 or oppo_location
      target_player=target_player==nil and player or target_player
      return Duel.GetMatchingGroup(link_card_filter,player,loc1,loc2,nil,by_filter,...):GetLinkedZone(target_player)&ZONES_MMZ
    end
    function aux.zptfilter(c,ec)
      return not c:IsLocation(LOCATION_MZONE) and (ec:GetLinkedZone(c:GetPreviousControler())&(1<<c:GetPreviousSequence()))~=0
    end
    function aux.zptgroup(eg,filter,c,tp)
      local result=Group.CreateGroup()
      local linked=c:GetLinkedGroup()
      local fil=eg:Filter(function(cc) return not filter or filter(cc,tp) end,nil)
      for tc in aux.Next(fil) do
        if linked:IsContains(tc) then result:AddCard(tc) end
      end
      for tc in aux.Next(eg:Filter(aux.zptfilter,nil,c)) do
        result:AddCard(tc)
      end
      return result
    end
    function aux.zptgroupcon(eg,filter,c,tp)
      local linked=c:GetLinkedGroup()
      local fil=eg:Filter(function(cc) return not filter or filter(cc,tp) end,nil)
      for tc in aux.Next(fil) do
        if linked:IsContains(tc) then return true end
      end
      return eg:IsExists(aux.zptfilter,1,nil,c)
    end
    function aux.zptcon(filter)
      return function(e,tp,eg,ep,ev,re,r,rp)
        return aux.zptgroupcon(eg,filter,e:GetHandler(),tp)
      end
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
    local card_summon_gate = CARD_SUMMON_GATE or 29724053
    function aux.CheckSummonGate(tp,count)
      local total=nil
      for _,eff in ipairs({Duel.GetPlayerEffect(tp,card_summon_gate)}) do
        local value=eff:GetValue()
        if value then
          if type(value)=="function" then value=value(tp) end
          total=total and math.min(total,value) or value
        end
      end
      if count then return not total or total>=count end
      return total
    end
    function aux.ResetEffects(g,eff)
      for c in aux.Next(g) do
        local effects={c:GetCardEffect(eff)}
        for _,te in ipairs(effects) do
          te:Reset()
        end
      end
    end
    function aux.DelayedOperation(card_or_group,phase,flag,e,tp,oper,cond,reset,reset_count,hint,effect_desc)
      local group=aux.IsGroupObject(card_or_group) and card_or_group or Group.FromCards(card_or_group)
      if group:GetCount()==0 then return nil end
      reset=reset or (RESET_PHASE|phase)
      reset_count=reset_count or 1
      local field_id=e and e.GetFieldID and e:GetFieldID() or 0
      local function affected_filter(c,label) return c:GetFlagEffectLabel(flag)==label end
      local function affected_group(effect)
        return effect:GetLabelObject():Filter(affected_filter,nil,effect:GetLabel())
      end
      local c=e and e.GetHandler and e:GetHandler() or group:GetFirst()
      local e1=Effect.CreateEffect(c)
      if effect_desc then e1:SetDescription(effect_desc) end
      e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
      e1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
      e1:SetCode(EVENT_PHASE|phase)
      e1:SetReset(reset,reset_count)
      e1:SetCountLimit(1)
      e1:SetLabel(field_id)
      e1:SetLabelObject(group)
      e1:SetCondition(function(te,...)
        local affected=affected_group(te)
        return affected:GetCount()>0 and (not cond or cond(affected,te,...))
      end)
      e1:SetOperation(function(te,...)
        if oper then oper(affected_group(te),te,...) end
      end)
      Duel.RegisterEffect(e1,tp or 0)
      local flag_property=hint and EFFECT_FLAG_CLIENT_HINT or 0
      for tc in aux.Next(group) do
        tc:RegisterFlagEffect(flag,RESET_EVENT+RESETS_STANDARD,flag_property,1,field_id,hint)
      end
      group:KeepAlive()
      return e1
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
    function aux.DoubleSnareValidity(c,range,property)
      if not c then return nil end
      local eff=Effect.CreateEffect(c)
      eff:SetType(EFFECT_TYPE_SINGLE)
      eff:SetProperty(EFFECT_FLAG_CANNOT_DISABLE|EFFECT_FLAG_SINGLE_RANGE|(property or 0))
      eff:SetRange(range)
      eff:SetCode(3682106)
      c:RegisterEffect(eff)
      return eff
    end
    function aux.AddLavaProcedure(c,required,position,filter,value,description)
      required=required or 1
      position=position or POS_FACEUP
      filter=filter or Card.IsMonster
      local e1=Effect.CreateEffect(c)
      if description then e1:SetDescription(description) end
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(EFFECT_SPSUMMON_PROC)
      e1:SetProperty(EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_SPSUM_PARAM)
      e1:SetRange(LOCATION_HAND)
      e1:SetTargetRange(position,1)
      e1:SetValue(value or 0)
      e1:SetCondition(function(e,sc)
        if sc==nil then return true end
        return Duel.GetFieldGroupCount(sc:GetControler(),0,LOCATION_MZONE)>=required
      end)
      c:RegisterEffect(e1)
      return e1
    end
    function aux.AddKaijuProcedure(c)
      if c.SetUniqueOnField then c:SetUniqueOnField(1,0,aux.FilterBoolFunction(Card.IsSetCard,SET_KAIJU),LOCATION_MZONE) end
      local e1=aux.AddLavaProcedure(c,1,POS_FACEUP_ATTACK)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_FIELD)
      e2:SetCode(EFFECT_SPSUMMON_PROC)
      e2:SetRange(LOCATION_HAND)
      e2:SetProperty(EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_SPSUM_PARAM)
      e2:SetTargetRange(POS_FACEUP_ATTACK,0)
      e2:SetCondition(function(e,sc)
        if sc==nil then return true end
        local tp=sc:GetControler()
        return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_KAIJU),tp,0,LOCATION_MZONE,1,nil)
      end)
      c:RegisterEffect(e2)
      return e1,e2
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
      if aux.IsGroupObject(card_or_group) then
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
