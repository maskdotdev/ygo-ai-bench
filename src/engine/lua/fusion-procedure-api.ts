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
  function Fusion.AddProcFunRep2(c,f,minc,maxc,insf)
    return Fusion.AddProcMixRep(c,false,insf,f,minc,maxc)
  end
  function Fusion.AddProcFunFun(c,f1,f2,cc,insf)
    local funs={}
    for i=1,cc do funs[i]=f2 end
    return Fusion.AddProcMix(c,false,insf,f1,table.unpack(funs))
  end
  function Fusion.AddProcFunFunRep(c,f1,f2,minc,maxc,insf)
    return Fusion.AddProcMixRep(c,false,insf,f2,minc,maxc,f1)
  end
  function Fusion.AddProcCode2(c,code1,code2,sub,insf)
    return Fusion.AddProcMix(c,sub,insf,code1,code2)
  end
  function Fusion.AddProcCode3(c,code1,code2,code3,sub,insf)
    return Fusion.AddProcMix(c,sub,insf,code1,code2,code3)
  end
  function Fusion.AddProcCode4(c,code1,code2,code3,code4,sub,insf)
    return Fusion.AddProcMix(c,sub,insf,code1,code2,code3,code4)
  end
  function Fusion.AddProcCodeRep(c,code1,cc,sub,insf)
    local codes={}
    for i=1,cc do codes[i]=code1 end
    return Fusion.AddProcMix(c,sub,insf,table.unpack(codes))
  end
  function Fusion.AddProcCodeRep2(c,code1,minc,maxc,sub,insf)
    return Fusion.AddProcMixRep(c,sub,insf,code1,minc,maxc)
  end
  function Fusion.AddProcCodeFun(c,code1,f,cc,sub,insf)
    local funs={}
    for i=1,cc do funs[i]=f end
    return Fusion.AddProcMix(c,sub,insf,code1,table.unpack(funs))
  end
  function Fusion.AddProcCodeFunRep(c,code1,f,minc,maxc,sub,insf)
    return Fusion.AddProcMixRep(c,sub,insf,f,minc,maxc,code1)
  end
  function Fusion.AddProcCode2FunRep(c,code1,code2,f,minc,maxc,sub,insf)
    return Fusion.AddProcMixRep(c,sub,insf,f,minc,maxc,code1,code2)
  end
  function Fusion.AddContactProc(c,...)
    local mt=c:GetMetatable(false)
    if mt then mt.contact_fusion_proc={...} end
  end
  function Fusion.ContactOp(f)
    return function(e,tp,eg,ep,ev,re,r,rp,c)
      local g=e:GetLabelObject()
      c:SetMaterial(g)
      f(g,tp,c)
      g:DeleteGroup()
    end
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
  local function fusion_params(params,...)
    if type(params)=="table" and not params.__duel_uid then return params end
    local args={...}
    return {
      handler=params,
      fusfilter=args[1],
      matfilter=args[2],
      extrafil=args[3],
      extraop=args[4],
      gc=args[5],
      stage2=args[6],
      exactcount=args[7],
      value=args[8],
      location=args[9],
      chkf=args[10],
      desc=args[11],
      preselect=args[12],
      nosummoncheck=args[13],
      extratg=args[14],
      mincount=args[15],
      maxcount=args[16],
      sumpos=args[17],
    }
  end
  local function fusion_helper_params(params,...)
    if type(params)=="table" and not params.__duel_uid then return params end
    local args={...}
    return {
      fusfilter=params,
      matfilter=args[1],
      extrafil=args[2],
      extraop=args[3],
      gc=args[4],
      stage2=args[5],
      exactcount=args[6],
      value=args[7],
      location=args[8],
      chkf=args[9],
      preselect=args[10],
      nosummoncheck=args[11],
      extratg=args[12],
      mincount=args[13],
      maxcount=args[14],
      sumpos=args[15],
    }
  end
  function Fusion.CreateSummonEff(params,...)
    params=fusion_params(params,...)
    local handler=params.handler
    local e=Effect.CreateEffect(handler)
    if params.desc then e:SetDescription(params.desc) end
    e:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_FUSION_SUMMON)
    e:SetType(EFFECT_TYPE_ACTIVATE)
    e:SetCode(EVENT_FREE_CHAIN)
    e:SetTarget(Fusion.SummonEffTG(params))
    e:SetOperation(Fusion.SummonEffOP(params))
    return e
  end
  function Fusion.RegisterSummonEff(c,...)
    local is_params=type(c)=="table" and not c.__duel_uid
    local e=Fusion.CreateSummonEff(is_params and c or c,...)
    local handler=is_params and c.handler or c
    if handler then handler:RegisterEffect(e) end
    return e
  end
  local function fusion_material_group(params,e,tp)
    local mg=Duel.GetFusionMaterial(tp)
    local check=nil
    if params.matfilter then mg=mg:Filter(params.matfilter,nil,e,tp,0) end
    if params.extrafil then
      local ret={params.extrafil(e,tp,mg)}
      if ret[1] then mg:Merge(ret[1]) end
      check=ret[2]
    end
    return mg,check
  end
  local function fusion_forced_material(params,e)
    if not params.gc then return nil end
    if type(params.gc)=="function" then return params.gc(e) end
    return params.gc
  end
  local function fusion_material_count_ok(params,sg,tp,tc,check)
    local count=sg and sg:GetCount() or 0
    if count<=0 then return false end
    if params.exactcount and count~=params.exactcount then return false end
    if params.mincount and count<params.mincount then return false end
    if params.maxcount and count>params.maxcount then return false end
    if check and not check(tp,sg,tc) then return false end
    return true
  end
  local function fusion_summon_eff_filter(c,e,tp,mg,params,check)
    if not c:IsType(TYPE_FUSION) then return false end
    if params.fusfilter and not params.fusfilter(c,tp) then return false end
    if not c:IsCanBeSpecialSummoned(e,SUMMON_TYPE_FUSION,tp,false,false) then return false end
    local sg=Duel.SelectFusionMaterial(tp,c,mg,fusion_forced_material(params,e))
    return fusion_material_count_ok(params,sg,tp,c,check)
  end
  function Fusion.SummonEffTG(params,...)
    params=fusion_helper_params(params,...)
    return function(e,tp,eg,ep,ev,re,r,rp,chk)
      local location=params.location or LOCATION_EXTRA
      local mg,check=fusion_material_group(params,e,tp)
      if chk==0 then return Duel.IsExistingMatchingCard(fusion_summon_eff_filter,tp,location,0,1,nil,e,tp,mg,params,check) end
      Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,location)
      if params.extratg then params.extratg(e,tp,eg,ep,ev,re,r,rp,chk) end
    end
  end
  function Fusion.SummonEffOP(params,...)
    params=fusion_helper_params(params,...)
    return function(e,tp,eg,ep,ev,re,r,rp)
      local location=params.location or LOCATION_EXTRA
      local mg,check=fusion_material_group(params,e,tp)
      local g=Duel.GetMatchingGroup(fusion_summon_eff_filter,tp,location,0,nil,e,tp,mg,params,check)
      local tc=g and g:GetFirst()
      if not tc then return end
      if params.preselect and params.preselect(e,tc)==false then return end
      local sg=Duel.SelectFusionMaterial(tp,tc,mg,fusion_forced_material(params,e))
      if not fusion_material_count_ok(params,sg,tp,tc,check) then return end
      local backupmat=sg:Clone()
      if params.extraop then
        tc:SetMaterial(backupmat)
        if params.extraop(e,tc,tp,sg)==false then return end
        Duel.BreakEffect()
        Duel.FusionSummon(tp,tc,backupmat,true)
      else
        Duel.FusionSummon(tp,tc,sg,false,true)
      end
      if params.stage2 then
        params.stage2(e,tc,tp,backupmat,0)
        params.stage2(e,tc,tp,backupmat,3)
        params.stage2(e,tc,tp,backupmat,1)
        params.stage2(e,nil,tp,nil,2)
      end
    end
  end
  function Fusion.OnFieldMat(filter,...)
    if type(filter)=="table" and filter.IsOnField then return filter:IsOnField() and filter:IsAbleToGrave() end
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
    if type(filter)=="table" and filter.IsLocation then return filter:IsLocation(LOCATION_HAND) and filter:IsAbleToGrave() end
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
