import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installSkillProcedureApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const source = `
    HINT_SKILL = HINT_SKILL or 200
    HINT_SKILL_COVER = HINT_SKILL_COVER or 201
    HINT_SKILL_FLIP = HINT_SKILL_FLIP or 202
    HINT_SKILL_REMOVE = HINT_SKILL_REMOVE or 203
    SKILL_COVER = SKILL_COVER or 300000000
    VRAINS_SKILL_COVER = VRAINS_SKILL_COVER or 300000001
    EFFECT_NEGATE_SKILL = EFFECT_NEGATE_SKILL or 152000015

    function aux.GetCover(c,coverNum)
      return SKILL_COVER + ((coverNum or 0) * 1000000) + c:GetOriginalRace()
    end

    function aux.SkillStartupOperation(c,coverNum,skillcon,skillop,countlimit,efftype)
      return function(e,tp,eg,ep,ev,re,r,rp)
        if skillop then
          local e1=Effect.CreateEffect(c)
          e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
          e1:SetCode(efftype or EVENT_FREE_CHAIN)
          if type(countlimit)=="number" then e1:SetCountLimit(countlimit) end
          if skillcon then e1:SetCondition(skillcon) end
          e1:SetOperation(skillop)
          Duel.RegisterEffect(e1,e:GetHandlerPlayer())
        end
      end
    end

    function aux.AddSkillProcedure(c,coverNum,drawless,skillcon,skillop,countlimit)
      local e1=Effect.CreateEffect(c)
      e1:SetProperty(EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_CANNOT_DISABLE)
      e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
      e1:SetCode(EVENT_STARTUP)
      e1:SetRange(0x5f)
      e1:SetLabel(aux.GetCover(c,coverNum))
      e1:SetOperation(aux.SkillStartupOperation(c,coverNum,skillcon,skillop,countlimit,EVENT_FREE_CHAIN))
      c:RegisterEffect(e1)
      aux.AddDrawless(c,drawless)
      return e1
    end

    function aux.AddPreDrawSkillProcedure(c,coverNum,drawless,skillcon,skillop,countlimit)
      local e1=Effect.CreateEffect(c)
      e1:SetProperty(EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_CANNOT_DISABLE)
      e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
      e1:SetCode(EVENT_STARTUP)
      e1:SetRange(0x5f)
      e1:SetLabel(aux.GetCover(c,coverNum))
      e1:SetOperation(aux.SkillStartupOperation(c,coverNum,skillcon,skillop,countlimit,EVENT_PREDRAW))
      c:RegisterEffect(e1)
      aux.AddDrawless(c,drawless)
      return e1
    end

    function aux.AddFieldSkillProcedure(c,coverNum,drawless)
      local e1=Effect.CreateEffect(c)
      e1:SetProperty(EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_CANNOT_DISABLE)
      e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
      e1:SetCode(EVENT_STARTUP)
      e1:SetCountLimit(1)
      e1:SetRange(0x5f)
      e1:SetLabel(aux.GetCover(c,coverNum))
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE)
      e2:SetRange(0xff)
      e2:SetCode(EFFECT_CANNOT_TO_DECK)
      e2:SetValue(1)
      c:RegisterEffect(e2)
      aux.AddDrawless(c,drawless)
      return e1,e2
    end

    function aux.AddContinuousSkillProcedure(c,coverNum,drawless,flip)
      local e1,e2=aux.AddFieldSkillProcedure(c,coverNum,drawless)
      e1:SetValue(flip and 1 or 0)
      return e1,e2
    end

    function aux.VrainsSkillStartupOperation(c,skillcon,skillop,efftype)
      return function(e,tp,eg,ep,ev,re,r,rp)
        if skillop then
          local e1=Effect.CreateEffect(c)
          if efftype==EFFECT_NEGATE_SKILL then
            e1:SetType(EFFECT_TYPE_FIELD)
            e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
            e1:SetTargetRange(1,0)
          else
            e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
          end
          e1:SetCode(efftype or EVENT_FREE_CHAIN)
          if skillcon then e1:SetCondition(skillcon) end
          e1:SetOperation(skillop)
          Duel.RegisterEffect(e1,e:GetHandlerPlayer())
          if efftype==EVENT_FREE_CHAIN then
            local e2=Effect.CreateEffect(c)
            e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
            e2:SetCode(EVENT_CHAIN_END)
            if skillcon then e2:SetCondition(skillcon) end
            e2:SetOperation(skillop)
            Duel.RegisterEffect(e2,e:GetHandlerPlayer())
          end
        end
      end
    end

    function aux.AddVrainsSkillProcedure(c,skillcon,skillop,efftype)
      efftype=efftype or EVENT_FREE_CHAIN
      local e1=Effect.CreateEffect(c)
      e1:SetProperty(EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_CANNOT_DISABLE)
      e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
      e1:SetCode(EVENT_STARTUP)
      e1:SetRange(0x5f)
      e1:SetLabel(VRAINS_SKILL_COVER)
      e1:SetOperation(aux.VrainsSkillStartupOperation(c,skillcon,skillop,efftype))
      c:RegisterEffect(e1)
      return e1
    end

    function aux.CheckSkillNegation(e,tp)
      local eff=Duel.IsPlayerAffectedByEffect(1-tp,EFFECT_NEGATE_SKILL)
      if not eff then return false end
      local con=eff:GetCondition()
      if con and not con(eff,1-tp,e) then return false end
      local op=eff:GetOperation()
      if not op then return false end
      local negated=op(eff,1-tp,e)
      if negated then Duel.Hint(HINT_MESSAGE,tp,aux.Stringid(EFFECT_NEGATE_SKILL,1)) end
      return negated or false
    end

    Auxiliary=Auxiliary or aux
    Auxiliary.GetCover=aux.GetCover
    Auxiliary.AddSkillProcedure=aux.AddSkillProcedure
    Auxiliary.AddPreDrawSkillProcedure=aux.AddPreDrawSkillProcedure
    Auxiliary.AddFieldSkillProcedure=aux.AddFieldSkillProcedure
    Auxiliary.AddContinuousSkillProcedure=aux.AddContinuousSkillProcedure
    Auxiliary.AddVrainsSkillProcedure=aux.AddVrainsSkillProcedure
    Auxiliary.CheckSkillNegation=aux.CheckSkillNegation
  `;
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(source), source.length, to_luastring("skill-procedure.lua"));
  if (status !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) throw new Error(readLuaError(L));
}
