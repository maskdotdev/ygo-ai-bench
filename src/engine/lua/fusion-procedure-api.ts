export const fusionProcedureSource = `
  aux.FusionProcedure=aux.FusionProcedure or Fusion or {}
  Fusion=aux.FusionProcedure
  function Fusion.AddProcMix(c,...)
    local mt=c:GetMetatable(false)
    if mt then mt.fusion_materials={...} end
  end
  function Fusion.AddProcMixRep(c,...)
    local mt=c:GetMetatable(false)
    if mt then mt.fusion_materials={...} end
  end
  function Fusion.AddProcMixN(c,...)
    local mt=c:GetMetatable(false)
    if mt then mt.fusion_materials={...} end
  end
  function Fusion.AddProcFunRep(c,...)
    local mt=c:GetMetatable(false)
    if mt then mt.fusion_materials={...} end
  end
  function Fusion.AddProcFun2(c,f1,f2,insf)
    return Fusion.AddProcMix(c,false,insf,f1,f2)
  end
  function Fusion.AddContactProc(c,...)
    local mt=c:GetMetatable(false)
    if mt then mt.contact_fusion_proc={...} end
  end
  function Fusion.CheckWithHandler(fun,...)
    local funs={fun,...}
    return function(c,e,...)
      if e and e.GetHandler and c==e:GetHandler() then return true end
      for _,fil in ipairs(funs) do
        if fil and fil(c,e,...) then return true end
      end
      return false
    end
  end
  function Fusion.CreateSummonEff(params,...)
    local handler=type(params)=="table" and params.handler or params
    local e=Effect.CreateEffect(handler)
    if type(params)=="table" and params.desc then e:SetDescription(params.desc) end
    e:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_FUSION_SUMMON)
    e:SetType(EFFECT_TYPE_ACTIVATE)
    e:SetCode(EVENT_FREE_CHAIN)
    e:SetTarget(Fusion.SummonEffTG())
    e:SetOperation(Fusion.SummonEffOP())
    return e
  end
  function Fusion.RegisterSummonEff(c,...)
    local is_table=type(c)=="table"
    local e=Fusion.CreateSummonEff(is_table and c or c,...)
    local handler=is_table and c.handler or c
    if handler then handler:RegisterEffect(e) end
    return e
  end
  function Fusion.SummonEffTG(...)
    return function(e,tp,eg,ep,ev,re,r,rp,chk) return chk~=0 or true end
  end
  function Fusion.SummonEffOP(...)
    return function(e,tp,eg,ep,ev,re,r,rp) return true end
  end
  function Fusion.OnFieldMat(filter,...)
    local funs={filter,...}
    return function(c,...)
      if not c:IsOnField() then return false end
      for _,fil in ipairs(funs) do
        if fil and not fil(c,...) then return false end
      end
      return true
    end
  end
  function Fusion.InHandMat(filter,...)
    local funs={filter,...}
    return function(c,...)
      if not c:IsLocation(LOCATION_HAND) then return false end
      for _,fil in ipairs(funs) do
        if fil and not fil(c,...) then return false end
      end
      return true
    end
  end
  function Fusion.BanishMaterial(e,tc,tp,sg)
    local moved=Duel.Remove(sg,POS_FACEUP,REASON_EFFECT+REASON_MATERIAL+REASON_FUSION)
    if sg and sg.Clear then sg:Clear() end
    return moved
  end
  function Fusion.ShuffleMaterial(e,tc,tp,sg)
    local moved=Duel.SendtoDeck(sg,nil,2,REASON_EFFECT+REASON_MATERIAL+REASON_FUSION)
    if sg and sg.Clear then sg:Clear() end
    return moved
  end
  function Fusion.IsMonsterFilter(f1,...)
    local funs={f1,...}
    return function(c,...)
      if not c:IsMonster() then return false end
      for _,fil in ipairs(funs) do
        if fil and not fil(c,...) then return false end
      end
      return true
    end
  end
  function Fusion.ForcedHandler(e)
    return e:GetHandler()
  end
`;
