import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installCardProcedureApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const source = `
    function Card.AddCannotBeSpecialSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      c:RegisterEffect(e0)
      return e0
    end
    Card.AddMustBeSpecialSummoned=Card.AddCannotBeSpecialSummoned
    function Card.AddMustBeSpecialSummonedByCardEffect(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(function(e,sum_eff,sum_p,sum_type) return sum_eff:IsHasType(EFFECT_TYPE_ACTIONS) end)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddMustBeSpecialSummonedByDarkFusion(c)
      local mt=Duel.GetMetatable(c:GetOriginalCode())
      mt.dark_calling=true
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(aux.EvilHeroLimit)
      c:RegisterEffect(e0)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e1:SetCode(CARD_CLOCK_LIZARD or 51476410)
      e1:SetCondition(function(e) return not Duel.IsPlayerAffectedByEffect(e:GetHandlerPlayer(),EFFECT_SUPREME_CASTLE or 72043279) end)
      e1:SetValue(1)
      c:RegisterEffect(e1)
      return e0
    end
    function Card.AddMustBeFusionSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(aux.fuslimit)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddMustFirstBeFusionSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(function(e,sum_eff,sum_p,sum_type) return not e:GetHandler():IsLocation(LOCATION_EXTRA) or (sum_type&SUMMON_TYPE_FUSION)==SUMMON_TYPE_FUSION end)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddMustBeRitualSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(aux.ritlimit)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddMustFirstBeRitualSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(function(e,sum_eff,sum_p,sum_type) return e:GetHandler():IsStatus(STATUS_PROC_COMPLETE) or (sum_type&SUMMON_TYPE_RITUAL)==SUMMON_TYPE_RITUAL end)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddMustBeSynchroSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(aux.synlimit)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddMustFirstBeSynchroSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(function(e,sum_eff,sum_p,sum_type) return not e:GetHandler():IsLocation(LOCATION_EXTRA) or (sum_type&SUMMON_TYPE_SYNCHRO)==SUMMON_TYPE_SYNCHRO end)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddMustBeXyzSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(aux.xyzlimit)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddMustFirstBeXyzSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(function(e,sum_eff,sum_p,sum_type) return not e:GetHandler():IsLocation(LOCATION_EXTRA) or (sum_type&SUMMON_TYPE_XYZ)==SUMMON_TYPE_XYZ end)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddMustBeLinkSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(aux.lnklimit)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddMustFirstBeLinkSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(function(e,sum_eff,sum_p,sum_type) return not e:GetHandler():IsLocation(LOCATION_EXTRA) or (sum_type&SUMMON_TYPE_LINK)==SUMMON_TYPE_LINK end)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddMustBePendulumSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(aux.penlimit)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddMustFirstBePendulumSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(function(e,sum_eff,sum_p,sum_type) return e:GetHandler():IsStatus(STATUS_PROC_COMPLETE) or (sum_type&SUMMON_TYPE_PENDULUM)==SUMMON_TYPE_PENDULUM end)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddCannotBeNormalSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_CANNOT_SUMMON)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.AddCannotBeFlipSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_CANNOT_FLIP_SUMMON)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.EnableReviveLimit(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_REVIVE_LIMIT)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.EnableGeminiStatus(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetCode(EFFECT_GEMINI_STATUS)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.IsGeminiStatus(c)
      return c:IsHasEffect(EFFECT_GEMINI_STATUS)~=nil
    end
    function Card.GetTributeRequirement(c)
      local mt=c:GetMetatable()
      if mt and mt.min_tribute_req and mt.max_tribute_req then return mt.min_tribute_req,mt.max_tribute_req end
      local level=c:GetLevel()
      if level>=7 then return 2,2 end
      if level>=5 then return 1,1 end
      return 0,0
    end
    function Card.GetMaximumAttack(c)
      local mt=c:GetMetatable(false)
      if not mt then return 0 end
      return mt.MaximumAttack or 0
    end
    function Card.AddMaximumAtkHandler(c)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_CANNOT_DISABLE)
      e1:SetRange(LOCATION_MZONE)
      e1:SetCondition(function(e) return e:GetHandler():IsMaximumMode() end)
      e1:SetCode(EFFECT_SET_BASE_ATTACK)
      e1:SetValue(c:GetMaximumAttack())
      c:RegisterEffect(e1)
      return e1
    end
    local function setcodecondition(e)
      local c=e:GetHandler()
      local label=e:GetLabel()
      if label>0 and c:GetOriginalCodeRule()==label then
        return c:IsCode(c:GetOriginalCodeRule())
      else
        return true
      end
    end
    function Card.AddSetcodesRule(c,code,copyable,...)
      local prop=0
      if not copyable then prop=EFFECT_FLAG_UNCOPYABLE end
      local t={}
      for _,setcode in pairs({...}) do
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+prop)
        e:SetCode(EFFECT_ADD_SETCODE)
        e:SetValue(setcode)
        e:SetLabel(code)
        e:SetCondition(setcodecondition)
        c:RegisterEffect(e)
        table.insert(t,e)
      end
      return t
    end
    function Card.AddPiercing(c,reset,rc,condition,properties)
      local e1=nil
      if rc then
        e1=Effect.CreateEffect(rc)
      else
        e1=Effect.CreateEffect(c)
      end
      e1:SetDescription(3208)
      if not properties then properties=0 end
      e1:SetProperty(EFFECT_FLAG_CLIENT_HINT+properties)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(EFFECT_PIERCE)
      if condition then e1:SetCondition(condition) end
      if reset then e1:SetReset(reset) end
      c:RegisterEffect(e1)
      return e1
    end
    Maximum=Maximum or {}
    function Maximum.centerCon(e)
      return e:GetHandler():IsMaximumModeCenter()
    end
    function Maximum.eftg(e,c)
      return c:IsType(TYPE_EFFECT) and c:IsMaximumModeSide()
    end
    function Maximum.GetMaximumCenter(tp)
      return Duel.GetMatchingGroup(Card.IsMaximumModeCenter,tp,LOCATION_MZONE,0,nil):GetFirst()
    end
    function Maximum.maxCenterVal(f)
      return function(e,c)
        local tc=Maximum.GetMaximumCenter(e:GetHandlerPlayer())
        return tc and f(tc)
      end
    end
    function Maximum.eftgMax(e,c)
      return c:IsType(TYPE_EFFECT) and c:IsMaximumMode() and c~=e:GetHandler()
    end
    function Maximum.sideCon(e)
      local tc=Maximum.GetMaximumCenter(e:GetHandlerPlayer())
      return tc and e:GetHandler():IsMaximumModeSide()
    end
    function Maximum.SelfDestructCondition(e)
      return e:GetHandler():IsMaximumModeSide() and not Duel.IsExistingMatchingCard(Card.IsMaximumModeCenter,e:GetHandlerPlayer(),LOCATION_ONFIELD,0,1,nil)
    end
    function Card.AddCenterToSideEffectHandler(c,eff)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_GRANT)
      e1:SetRange(LOCATION_MZONE)
      e1:SetTargetRange(LOCATION_MZONE,0)
      e1:SetCondition(Maximum.centerCon)
      e1:SetTarget(Maximum.eftg)
      e1:SetLabelObject(eff)
      c:RegisterEffect(e1)
      return e1
    end
    function Card.AddSideMaximumHandler(c,eff)
      local baseeff=Effect.CreateEffect(c)
      baseeff:SetType(EFFECT_TYPE_SINGLE)
      baseeff:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_CANNOT_DISABLE)
      baseeff:SetRange(LOCATION_MZONE)
      baseeff:SetCondition(Maximum.sideCon)
      local e1=baseeff:Clone()
      e1:SetCode(EFFECT_SET_BASE_ATTACK)
      e1:SetValue(Maximum.maxCenterVal(Card.GetMaximumAttack))
      c:RegisterEffect(e1)
      local e0=baseeff:Clone()
      e0:SetCode(EFFECT_SET_ATTACK_FINAL)
      e0:SetValue(Maximum.maxCenterVal(Card.GetAttack))
      c:RegisterEffect(e0)
      local e2=baseeff:Clone()
      e2:SetCode(EFFECT_CHANGE_LEVEL)
      e2:SetValue(Maximum.maxCenterVal(Card.GetLevel))
      c:RegisterEffect(e2)
      local e3=baseeff:Clone()
      e3:SetCode(EFFECT_CHANGE_CODE)
      e3:SetValue(Maximum.maxCenterVal(Card.GetCode))
      c:RegisterEffect(e3)
      local e4=baseeff:Clone()
      e4:SetCode(EFFECT_CHANGE_RACE)
      e4:SetValue(Maximum.maxCenterVal(Card.GetRace))
      c:RegisterEffect(e4)
      local e5=baseeff:Clone()
      e5:SetCode(EFFECT_CHANGE_ATTRIBUTE)
      e5:SetValue(Maximum.maxCenterVal(Card.GetAttribute))
      c:RegisterEffect(e5)
      local e6=Effect.CreateEffect(c)
      e6:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_GRANT)
      e6:SetRange(LOCATION_MZONE)
      e6:SetTargetRange(LOCATION_MZONE,0)
      e6:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e6:SetCondition(Maximum.sideCon)
      e6:SetTarget(Maximum.eftgMax)
      e6:SetLabelObject(eff)
      c:RegisterEffect(e6)
      local e7=baseeff:Clone()
      e7:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)
      e7:SetValue(aux.imval1)
      c:RegisterEffect(e7)
      local e8=baseeff:Clone()
      e8:SetCode(EFFECT_CANNOT_CHANGE_POSITION)
      c:RegisterEffect(e8)
      local e9=baseeff:Clone()
      e9:SetCode(EFFECT_CANNOT_CHANGE_POS_E)
      c:RegisterEffect(e9)
      local e10=Effect.CreateEffect(c)
      e10:SetType(EFFECT_TYPE_SINGLE)
      e10:SetCode(EFFECT_UNRELEASABLE_SUM)
      e10:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e10:SetCondition(Maximum.sideCon)
      e10:SetValue(1)
      c:RegisterEffect(e10)
      local e11=Effect.CreateEffect(c)
      e11:SetType(EFFECT_TYPE_SINGLE)
      e11:SetCode(EFFECT_CANNOT_ATTACK)
      e11:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e11:SetCondition(Maximum.sideCon)
      c:RegisterEffect(e11)
      local e12=baseeff:Clone()
      e12:SetCode(EFFECT_CANNOT_TRIGGER)
      c:RegisterEffect(e12)
      local e13=Effect.CreateEffect(c)
      e13:SetType(EFFECT_TYPE_SINGLE)
      e13:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e13:SetCode(EFFECT_CANNOT_BE_MATERIAL)
      e13:SetCondition(Maximum.sideCon)
      e13:SetValue(aux.cannotmatfilter(SUMMON_TYPE_FUSION,SUMMON_TYPE_SYNCHRO,SUMMON_TYPE_XYZ,SUMMON_TYPE_LINK))
      c:RegisterEffect(e13)
      local e14=Effect.CreateEffect(c)
      e14:SetType(EFFECT_TYPE_SINGLE)
      e14:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_CANNOT_DISABLE)
      e14:SetRange(LOCATION_MZONE)
      e14:SetCode(EFFECT_SELF_DESTROY)
      e14:SetCondition(Maximum.SelfDestructCondition)
      c:RegisterEffect(e14)
      local e16=Effect.CreateEffect(c)
      e16:SetType(EFFECT_TYPE_SINGLE)
      e16:SetCode(EFFECT_UPDATE_DEFENSE)
      e16:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e16:SetCondition(Maximum.sideCon)
      e16:SetValue(-1000000)
      c:RegisterEffect(e16)
      local e17=Effect.CreateEffect(c)
      e17:SetType(EFFECT_TYPE_SINGLE)
      e17:SetCode(EFFECT_UNRELEASABLE_NONSUM)
      e17:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e17:SetCondition(Maximum.sideCon)
      e17:SetValue(1)
      c:RegisterEffect(e17)
      baseeff:Reset()
    end
    function Card.IsLegend(c)
      local mt=c:GetMetatable(false)
      return c:IsHasEffect(EFFECT_IS_LEGEND)~=nil or (mt and mt.is_legend==true) or c:IsOriginalCode(160001000,160205001,160418001,160002000,160421015,160404001,160421016,160432004)
    end
    local function has_marker(c,marker)
      return (c:GetLinkMarker()&marker)~=0
    end
    function Card.GetToBeLinkedZone(tc,c,tp,clink,emz)
      if not tc:IsLocation(LOCATION_MZONE) then return 0 end
      local seq=tc:GetSequence()
      local zone=0
      if tc:IsControler(tp) then
        if has_marker(c,0x8) and seq<4 and (not clink or has_marker(tc,0x20)) then zone=zone|(1<<(seq+1)) end
        if has_marker(c,0x20) and seq>0 and seq<=4 and (not clink or has_marker(tc,0x8)) then zone=zone|(1<<(seq-1)) end
        if has_marker(c,0x2) and seq>=0 and seq<=4 and (not clink or has_marker(tc,0x2)) then zone=zone|(1<<seq) end
      end
      return zone&ZONES_MMZ
    end
    function Card.ListsCardType(c,...)
      local mt=c:GetMetatable(false)
      if not mt or not mt.listed_card_types then return false end
      local requested={...}
      for _,typ in ipairs(requested) do
        for _,listed in ipairs(mt.listed_card_types) do
          if (typ&listed)~=0 then return true end
        end
      end
      return false
    end
    function Card.ListsArchetype(c,...)
      local mt=c:GetMetatable(false)
      if not mt or not mt.listed_series then return false end
      local requested={...}
      for _,setcode in ipairs(requested) do
        for _,listed in ipairs(mt.listed_series) do
          if setcode==listed then return true end
        end
      end
      return false
    end
    function Card.ListsCounter(c,counter_type)
      local mt=c:GetMetatable(false)
      if not mt then return false end
      local listed=mt.counter_list or mt.counter_place_list
      if not listed then return false end
      for _,counter in ipairs(listed) do
        if counter_type==counter then return true end
      end
      return false
    end
    function Card.PlacesCounter(c,counter_type)
      local mt=c:GetMetatable(false)
      if not mt or not mt.counter_place_list then return false end
      for _,counter in ipairs(mt.counter_place_list) do
        if counter_type==counter then return true end
      end
      return false
    end
    function Card.IsNouvellesSummoned(c)
      return c:HasFlagEffect(c:GetOriginalCode())
    end
    function Card.IsLineMonster(c)
      return c:IsSetCard(0x564)
    end
    function Card.NegateEffects(tc,c,reset,negates_cards,ct)
      if not reset then reset=RESET_EVENT|RESETS_STANDARD end
      reset=reset|(RESET_EVENT|RESETS_STANDARD)
      local trap_monster_chk=negates_cards and tc:IsType(TYPE_TRAPMONSTER)
      if trap_monster_chk then reset=reset&~(RESET_TOFIELD|RESET_LEAVE|RESET_TURN_SET) end
      if not ct then ct=1 end
      Duel.NegateRelatedChain(tc,RESET_TURN_SET)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e1:SetCode(EFFECT_DISABLE)
      e1:SetReset(reset,ct)
      tc:RegisterEffect(e1)
      local e2=e1:Clone()
      e2:SetCode(EFFECT_DISABLE_EFFECT)
      e2:SetValue(RESET_TURN_SET)
      tc:RegisterEffect(e2)
      if trap_monster_chk then
        local e3=e1:Clone()
        e3:SetCode(EFFECT_DISABLE_TRAPMONSTER)
        tc:RegisterEffect(e3)
      end
    end
    function Card.CheckEquipTargetRush(equip,monster)
      local effect=equip:GetActivateEffect()
      if effect~=nil then
        local filter=effect:GetTarget()
        if filter~=nil then
          return filter(effect,effect:GetHandlerPlayer(),nil,nil,nil,nil,nil,nil,nil,monster)
        end
      end
      return false
    end
    function Card.AddNoTributeCheck(c,id,stringid,rangeP1,rangeP2)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(FLAG_NO_TRIBUTE)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetRange(LOCATION_MZONE)
      e1:SetDescription(aux.Stringid(id,stringid))
      e1:SetReset(RESET_PHASE+PHASE_END+RESET_OPPO_TURN,1)
      e1:SetTargetRange(rangeP1,rangeP2)
      c:RegisterEffect(e1)
      return e1
    end
    function Duel.AddNoTributeCheck(c,tp,id,stringid,rangeP1,rangeP2)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetCode(FLAG_NO_TRIBUTE)
      e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CLIENT_HINT)
      e1:SetDescription(aux.Stringid(id,stringid))
      e1:SetTargetRange(rangeP1,rangeP2)
      e1:SetReset(RESET_PHASE+PHASE_END+RESET_OPPO_TURN,1)
      Duel.RegisterEffect(e1,tp)
      return e1
    end
    function Card.AddDoubleTribute(c,id,otfilter,eftg,reset,...)
      for _,flag in ipairs({...}) do
        c:RegisterFlagEffect(flag,reset,0,1)
      end
      c:RegisterFlagEffect(FLAG_HAS_DOUBLE_TRIBUTE,reset,0,1)
      local e1=aux.summonproc(c,true,true,1,1,SUMMON_TYPE_TRIBUTE+100,aux.Stringid(id,0),otfilter)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_GRANT)
      e2:SetRange(LOCATION_MZONE)
      e2:SetTargetRange(LOCATION_HAND,LOCATION_HAND)
      e2:SetTarget(eftg)
      e2:SetLabelObject(e1)
      if reset~=0 then e2:SetReset(reset) end
      c:RegisterEffect(e2)
      local e3=aux.summonproc3trib(c,aux.Stringid(id,1),otfilter)
      local e4=Effect.CreateEffect(c)
      e4:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_GRANT)
      e4:SetRange(LOCATION_MZONE)
      e4:SetTargetRange(LOCATION_HAND,LOCATION_HAND)
      e4:SetTarget(aux.ThreeTribGrantTarget(eftg))
      e4:SetLabelObject(e3)
      if reset~=0 then e4:SetReset(reset) end
      c:RegisterEffect(e4)
    end
    function Card.CanBeDoubleTribute(c,...)
      if c:GetFlagEffect(FLAG_DOUBLE_TRIB)~=0 then return false end
      local totalFlags=0
      for _,flag in ipairs({...}) do
        totalFlags=totalFlags+flag
        if c:GetFlagEffect(flag)~=0 then return false end
      end
      if c:GetFlagEffect(totalFlags)~=0 then return false end
      return true
    end
  `;
  const status = lauxlib.luaL_dostring(L, to_luastring(source));
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
}
