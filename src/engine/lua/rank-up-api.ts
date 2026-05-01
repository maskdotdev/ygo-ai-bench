import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installRankUpApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const source = `
    FLAG_RANKUP = FLAG_RANKUP or 511001822
    EFFECT_RANKUP_EFFECT = EFFECT_RANKUP_EFFECT or 511001822

    local function each_card(cg,op)
      if cg.GetFirst then
        local tc=cg:GetFirst()
        while tc do
          op(tc)
          tc=cg:GetNext()
        end
      else
        op(cg)
      end
    end

    function aux.RankUpUsing(cg,id,hint)
      each_card(cg,function(c)
        c:RegisterFlagEffect(511000685,RESET_EVENT|RESETS_STANDARD&(~RESET_TOFIELD),hint and EFFECT_FLAG_CLIENT_HINT or 0,1)
        if id then c:SetFlagEffectLabel(511000685,id) end
      end)
    end

    function aux.RankUpComplete(cg,hint)
      each_card(cg,function(c)
        c:RegisterFlagEffect(511015134,RESET_EVENT|RESETS_STANDARD&(~RESET_TOFIELD),hint and EFFECT_FLAG_CLIENT_HINT or 0,1)
        if hint then c:SetFlagEffectLabel(511015134,hint) end
      end)
    end

    function aux.ReincarnationRitualFilter(c,rc,id,tp)
      return c:IsSummonCode(rc,SUMMON_TYPE_RITUAL,tp,id) and c:IsControler(tp) and c:IsLocation(LOCATION_MZONE)
    end

    function aux.RankUpCheckCondition(condition,...)
      local monsterFilter={...}
      local nameFilter={}
      for _,filter in ipairs(monsterFilter) do
        if type(filter)=="number" then nameFilter[filter]=true end
      end
      return function(e,tp,eg,ep,ev,re,r,rp)
        if e:GetHandler():GetFlagEffect(511015134)>0 then return true end
        if nameFilter[e:GetHandler():GetFlagEffectLabel(511000685)] then return true end
        return e:GetLabel()==1 and e:GetHandler():IsXyzSummoned()
          and (not condition or condition(e,tp,eg,ep,ev,re,r,rp))
      end
    end

    function aux.RankUpCheckOperation(operation,...)
      return function(e,tp,eg,ep,ev,re,r,rp)
        local c=e:GetHandler()
        for _,rankupEffect in ipairs({c:GetCardEffect(EFFECT_RANKUP_EFFECT)}) do
          local reset=rankupEffect:GetLabel()
          local te=rankupEffect:GetLabelObject():Clone()
          te:SetReset(reset>0 and reset or (RESET_EVENT|RESETS_STANDARD))
          c:RegisterEffect(te)
        end
        if operation then operation(e,tp,eg,ep,ev,re,r,rp) end
      end
    end

    function aux.EnableCheckRankUp(c,condition,operation,...)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)
      e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e1:SetCode(EVENT_SPSUMMON_SUCCESS)
      e1:SetCondition(aux.RankUpCheckCondition(condition,...))
      e1:SetOperation(aux.RankUpCheckOperation(operation,...))
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetCode(EFFECT_MATERIAL_CHECK)
      e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e2:SetLabelObject(e1)
      c:RegisterEffect(e2)
      return e1,e2
    end

    local ReincarnationChecked=false
    function aux.EnableCheckReincarnation(c)
      if ReincarnationChecked then return end
      ReincarnationChecked=true
      local e1=Effect.GlobalEffect()
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(EFFECT_MATERIAL_CHECK)
      local ge1=Effect.GlobalEffect()
      ge1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_GRANT)
      ge1:SetLabelObject(e1)
      ge1:SetTargetRange(0xff,0xff)
      ge1:SetTarget(function(e,c) return c:IsType(TYPE_FUSION+TYPE_RITUAL+TYPE_SYNCHRO+TYPE_XYZ+TYPE_LINK) end)
      Duel.RegisterEffect(ge1,0)
      return ge1
    end

    Auxiliary=Auxiliary or aux
    Auxiliary.RankUpUsing=aux.RankUpUsing
    Auxiliary.RankUpComplete=aux.RankUpComplete
    Auxiliary.ReincarnationRitualFilter=aux.ReincarnationRitualFilter
    Auxiliary.EnableCheckRankUp=aux.EnableCheckRankUp
    Auxiliary.EnableCheckReincarnation=aux.EnableCheckReincarnation
  `;
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(source), source.length, to_luastring("rank-up.lua"));
  if (status !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) throw new Error(readLuaError(L));
}
