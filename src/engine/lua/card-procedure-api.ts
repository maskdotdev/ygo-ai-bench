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
    function Card.AddMustBeRitualSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(aux.ritlimit)
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
    function Card.AddMustBeXyzSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(aux.xyzlimit)
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
    function Card.AddMustBePendulumSummoned(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e0:SetCode(EFFECT_SPSUMMON_CONDITION)
      e0:SetValue(aux.penlimit)
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
  `;
  const status = lauxlib.luaL_dostring(L, to_luastring(source));
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
}
