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
  `;
  const status = lauxlib.luaL_dostring(L, to_luastring(source));
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
}
