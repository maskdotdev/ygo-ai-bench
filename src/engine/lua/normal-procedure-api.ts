import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installNormalProcedureApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const source = `
    local function maplevel(level)
      if level>=5 and level<=6 then return 1 end
      if level>=7 then return 2 end
      return 0
    end
    local function update_tribute_req(c,min,max)
      if not c or not c.GetMetatable then return end
      local mt=c:GetMetatable()
      if not mt then return end
      if min~=nil and (mt.min_tribute_req==nil or min<mt.min_tribute_req) then mt.min_tribute_req=min end
      if max~=nil and (mt.max_tribute_req==nil or max>mt.max_tribute_req) then mt.max_tribute_req=max end
    end
    function aux.IsZone(c,zone,tp)
      if not c or zone==nil then return true end
      local seq=c:GetSequence()
      local rzone=c:IsControler(tp) and (1 << seq) or (1 << (16+seq))
      if c:IsSequence(5) or c:IsSequence(6) then
        rzone=rzone | (c:IsControler(tp) and (1 << (16+11-seq)) or (1 << (11-seq)))
      end
      return (rzone & zone) > 0
    end
    function aux.NormalSummonCondition1(min,max,f,opt)
      return function(e,c,minc,zone,relzone,exeff)
        if c==nil then return true end
        local tp=c:GetControler()
        local mg=Duel.GetTributeGroup(c)
        if relzone and relzone~=0 then
          mg:Match(aux.IsZone,nil,relzone,tp)
        end
        if f then
          mg:Match(f,nil,tp)
        end
        local tributes=maplevel(c:GetLevel())
        return (not opt or (tributes>0 and tributes~=max)) and (minc or 0)<=min and Duel.CheckTribute(c,min,max,mg,tp,zone)
      end
    end
    function aux.NormalSummonCondition2()
      return function(e,c,minc,zone,relzone,exeff)
        return c==nil
      end
    end
    function aux.NormalSummonTarget(min,max,f)
      return function(e,tp,eg,ep,ev,re,r,rp,chk,c,minc,zone,relzone,exeff)
        local mg=Duel.GetTributeGroup(c)
        if relzone and relzone~=0 then
          mg:Match(aux.IsZone,nil,relzone,tp)
        end
        if f then
          mg:Match(f,nil,tp)
        end
        if chk==0 then
          return Duel.CheckTribute(c,min,max,mg,tp,zone)
        end
        local g=Duel.SelectTribute(tp,c,min,max,mg,tp,zone,Duel.IsSummonCancelable())
        if g and #g>0 then
          g:KeepAlive()
          e:SetLabelObject(g)
          return true
        end
        return false
      end
    end
    function aux.NormalSummonOperation(min,max,sumop)
      return function(e,tp,eg,ep,ev,re,r,rp,c,minc,zone,relzone,exeff)
        local g=e:GetLabelObject()
        if not g then return end
        c:SetMaterial(g)
        Duel.Release(g,REASON_SUMMON+REASON_MATERIAL)
        if sumop then
          sumop(g:Clone(),e,tp,eg,ep,ev,re,r,rp,c,minc,zone,relzone,exeff)
        end
        g:DeleteGroup()
        e:SetLabelObject(nil)
      end
    end
    function aux.AddNormalSummonProcedure(c,ns,opt,min,max,val,desc,f,sumop)
      val=val or SUMMON_TYPE_TRIBUTE
      local e1=Effect.CreateEffect(c)
      if desc then e1:SetDescription(desc) end
      e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e1:SetType(EFFECT_TYPE_SINGLE)
      if ns and opt then
        e1:SetCode(EFFECT_SUMMON_PROC)
      else
        e1:SetCode(EFFECT_LIMIT_SUMMON_PROC)
        update_tribute_req(c,min,max)
      end
      if ns then
        e1:SetCondition(aux.NormalSummonCondition1(min or 0,max or min or 0,f,opt))
        e1:SetTarget(aux.NormalSummonTarget(min or 0,max or min or 0,f))
        e1:SetOperation(aux.NormalSummonOperation(min or 0,max or min or 0,sumop))
      else
        e1:SetCondition(aux.NormalSummonCondition2())
      end
      e1:SetValue(val)
      c:RegisterEffect(e1)
      return e1
    end
    function aux.summonproc(c,ns,opt,min,max,val,desc,f,sumop)
      val=val or SUMMON_TYPE_TRIBUTE
      local e1=Effect.CreateEffect(c)
      if desc then e1:SetDescription(desc) end
      e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e1:SetType(EFFECT_TYPE_SINGLE)
      if ns and opt then
        e1:SetCode(EFFECT_SUMMON_PROC)
      else
        e1:SetCode(EFFECT_LIMIT_SUMMON_PROC)
        update_tribute_req(c,min,max)
      end
      if ns then
        e1:SetCondition(aux.NormalSummonCondition1(min or 0,max or min or 0,f,opt))
        e1:SetTarget(aux.NormalSummonTarget(min or 0,max or min or 0,f))
        e1:SetOperation(aux.NormalSummonOperation(min or 0,max or min or 0,sumop))
      else
        e1:SetCondition(aux.NormalSummonCondition2())
      end
      e1:SetValue(val)
      return e1
    end
    function aux.ThreeTribGrantTarget(eftg)
      return function(e,c)
        return eftg(e,c) and c:GetFlagEffect(FLAG_TRIPLE_TRIBUTE)~=0
      end
    end
    function aux.ThreeTributeCondition(otfilter)
      return function(e,c)
        if c==nil then return true end
        if not c:IsLevelAbove(7) then return false end
        local tp=e:GetHandlerPlayer()
        local rg1=Duel.GetTributeGroup(c)
        local rg2=Duel.GetMatchingGroup(otfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil,tp)
        return rg1:GetCount()>=2 and rg2:GetCount()>=1
      end
    end
    function aux.ThreeTributeTarget(otfilter)
      return function(e,tp,eg,ep,ev,re,r,rp,chk,c,minc,zone,relzone,exeff)
        if chk==0 then return aux.ThreeTributeCondition(otfilter)(e,c) end
        local g=Duel.SelectTribute(tp,c,2,2)
        local extra=Duel.SelectMatchingCard(tp,otfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,g,tp)
        g:Merge(extra)
        g:KeepAlive()
        e:SetLabelObject(g)
        return true
      end
    end
    function aux.ThreeTributeOperation()
      return function(e,tp,eg,ep,ev,re,r,rp,c,minc,zone,relzone,exeff)
        local g=e:GetLabelObject()
        if not g then return end
        Duel.Release(g,REASON_SUMMON+REASON_MATERIAL)
        g:DeleteGroup()
        e:SetLabelObject(nil)
      end
    end
    function aux.summonproc3trib(c,desc,otfilter)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      if desc then e1:SetDescription(desc) end
      e1:SetCode(EFFECT_SUMMON_PROC)
      e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e1:SetCondition(aux.ThreeTributeCondition(otfilter))
      e1:SetTarget(aux.ThreeTributeTarget(otfilter))
      e1:SetOperation(aux.ThreeTributeOperation())
      e1:SetValue(SUMMON_TYPE_TRIBUTE+1)
      c:RegisterEffect(e1)
      return e1
    end
    function aux.NormalSetCondition1(min,max,f,opt)
      return aux.NormalSummonCondition1(min,max,f,opt)
    end
    function aux.NormalSetCondition2()
      return aux.NormalSummonCondition2()
    end
    function aux.NormalSetTarget(min,max,f)
      return aux.NormalSummonTarget(min,max,f)
    end
    function aux.NormalSetOperation(min,max,sumop)
      return aux.NormalSummonOperation(min,max,sumop)
    end
    function aux.AddNormalSetProcedure(c,ns,opt,min,max,val,desc,f,sumop)
      val=val or SUMMON_TYPE_TRIBUTE
      local e1=Effect.CreateEffect(c)
      if desc then e1:SetDescription(desc) end
      e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e1:SetType(EFFECT_TYPE_SINGLE)
      if ns and opt then
        e1:SetCode(EFFECT_SET_PROC)
      else
        e1:SetCode(EFFECT_LIMIT_SET_PROC)
        update_tribute_req(c,min,max)
      end
      if ns then
        e1:SetCondition(aux.NormalSetCondition1(min or 0,max or min or 0,f,opt))
        e1:SetTarget(aux.NormalSetTarget(min or 0,max or min or 0,f))
        e1:SetOperation(aux.NormalSetOperation(min or 0,max or min or 0,sumop))
      else
        e1:SetCondition(aux.NormalSetCondition2())
      end
      e1:SetValue(val)
      c:RegisterEffect(e1)
      return e1
    end
  `;
  const status = lauxlib.luaL_dostring(L, to_luastring(source));
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
}
