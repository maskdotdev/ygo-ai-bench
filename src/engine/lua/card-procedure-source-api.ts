import { fusionProcedureSource } from "#lua/fusion-procedure-api.js";
import { spiritProcedureSource } from "#lua/spirit-procedure-api.js";

export const cardProcedureSource = `${fusionProcedureSource}
    aux.RitualProcedure=aux.RitualProcedure or Ritual or {}
    Ritual=aux.RitualProcedure
    local function ritual_params(params,lvtype,filter,lv,desc,extrafil,extraop,matfilter,stage2,location,forcedselection,customoperation,specificmatfilter,requirementfunc,sumpos,extratg,self)
      if type(params)=="table" and params.__duel_uid==nil then return params end
      if type(params)=="function" then
        return {
          filter=params,lvtype=lvtype,lv=filter,desc=lv,extrafil=desc,extraop=extrafil,matfilter=extraop,
          stage2=matfilter,location=stage2,forcedselection=location,customoperation=forcedselection,
          specificmatfilter=customoperation,requirementfunc=specificmatfilter,sumpos=requirementfunc,extratg=sumpos,self=extratg,
        }
      end
      return {
        handler=params,lvtype=lvtype,filter=filter,lv=lv,desc=desc,extrafil=extrafil,extraop=extraop,matfilter=matfilter,
        stage2=stage2,location=location,forcedselection=forcedselection,customoperation=customoperation,
        specificmatfilter=specificmatfilter,requirementfunc=requirementfunc,sumpos=sumpos,extratg=extratg,self=self,
      }
    end
    local function ritual_target_location(params)
      return params.location or LOCATION_HAND
    end
    local function ritual_required_level(params,ritual_c)
      if type(params.lv)=="function" then return params.lv(ritual_c) or 0 end
      if type(params.lv)=="number" then return params.lv end
      return ritual_c:GetLevel()
    end
    local function ritual_material_level(material,params,ritual_c)
      return params.requirementfunc and params.requirementfunc(material,ritual_c) or material:GetRitualLevel(ritual_c)
    end
    local function ritual_material_pool(tp,ritual_c,params,e,eg,ep,ev,re,r,rp,chk)
      local mg=Duel.GetRitualMaterial(tp,ritual_c)
      if params.extrafil then
        local extra=params.extrafil(e,tp,eg,ep,ev,re,r,rp,chk)
        if extra then mg:Merge(extra) end
      end
      if ritual_c then mg:RemoveCard(ritual_c) end
      if params.matfilter then mg=mg:Filter(params.matfilter,nil,e,tp,ritual_c) end
      if params.specificmatfilter then mg:Match(params.specificmatfilter,nil,ritual_c,mg,tp) end
      return mg
    end
    local function ritual_selection_filter(g,e,tp,params,ritual_c,lv)
      if params.forcedselection and not params.forcedselection(e,tp,g,ritual_c) then return false end
      local sum=g:GetSum(ritual_material_level,params,ritual_c); return params.lvtype==RITPROC_GREATER and sum>=lv or sum==lv
    end
    local function ritual_has_materials(tp,ritual_c,params,e,eg,ep,ev,re,r,rp,chk)
      local mg=ritual_material_pool(tp,ritual_c,params,e,eg,ep,ev,re,r,rp,chk)
      local lv=ritual_required_level(params,ritual_c)
      if not mg or lv<=0 then return false end
      if params.forcedselection then return mg:CheckSubGroup(ritual_selection_filter,1,lv,e,tp,params,ritual_c,lv) end
      if params.lvtype==RITPROC_GREATER then
        return mg:CheckWithSumGreater(ritual_material_level,lv,1,lv,params,ritual_c)
      end
      return mg:CheckWithSumEqual(ritual_material_level,lv,1,lv,params,ritual_c)
    end
    local function ritual_filter(c,e,tp,params,eg,ep,ev,re,r,rp,chk)
      if not c:IsRitualMonster() then return false end
      if params.filter and not params.filter(c) then return false end
      if not c:IsCanBeSpecialSummoned(e,SUMMON_TYPE_RITUAL,tp,true,false,params.sumpos or POS_FACEUP) then return false end
      return ritual_has_materials(tp,c,params,e,eg,ep,ev,re,r,rp,chk)
    end
    function Ritual.Target(params,...)
      params=ritual_params(params,...)
      return function(e,tp,eg,ep,ev,re,r,rp,chk)
        local location=ritual_target_location(params)
        if chk==0 then
          local c=e:GetHandler()
          return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and (params.self and c and c:IsLocation(location) and ritual_filter(c,e,tp,params,eg,ep,ev,re,r,rp,chk) or (not params.self and Duel.IsExistingMatchingCard(ritual_filter,tp,location,0,1,nil,e,tp,params,eg,ep,ev,re,r,rp,chk)))
        end
        if params.extratg then params.extratg(e,tp,eg,ep,ev,re,r,rp,chk) end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,location)
      end
    end
    function Ritual.Operation(params,...)
      params=ritual_params(params,...)
      return function(e,tp,eg,ep,ev,re,r,rp)
        local location=ritual_target_location(params)
        local rc
        if params.self then rc=e:GetHandler(); if not (rc and rc:IsLocation(location) and ritual_filter(rc,e,tp,params,eg,ep,ev,re,r,rp)) then return end else local g=Duel.GetMatchingGroup(ritual_filter,tp,location,0,nil,e,tp,params,eg,ep,ev,re,r,rp); rc=g and g:GetFirst(); if not rc then return end end
        local mg=ritual_material_pool(tp,rc,params,e,eg,ep,ev,re,r,rp)
        local lv=ritual_required_level(params,rc)
        local sg=params.forcedselection and mg:SelectSubGroup(tp,ritual_selection_filter,false,1,lv,e,tp,params,rc,lv) or (params.lvtype==RITPROC_GREATER and mg:SelectWithSumGreater(tp,ritual_material_level,lv,1,lv,params,rc) or mg:SelectWithSumEqual(tp,ritual_material_level,lv,1,lv,params,rc))
        if sg and sg:GetCount()>0 then
          if params.customoperation then
            params.customoperation(sg:Clone(),e,tp,eg,ep,ev,re,r,rp,rc)
          elseif params.extraop then
            rc:SetMaterial(sg)
            params.extraop(sg:Clone(),e,tp,eg,ep,ev,re,r,rp,rc)
            Duel.BreakEffect()
            Duel.RitualSummon(rc,sg,true,params.sumpos)
            if rc:IsFacedown() then Duel.ConfirmCards(1-tp,rc) end
            if params.stage2 then params.stage2(sg,e,tp,eg,ep,ev,re,r,rp,rc) end
          else
            Duel.RitualSummon(rc,sg,false,params.sumpos)
            if rc:IsFacedown() then Duel.ConfirmCards(1-tp,rc) end
            if params.stage2 then params.stage2(sg,e,tp,eg,ep,ev,re,r,rp,rc) end
          end
        end
      end
    end
    function Ritual.CreateProc(params,...)
      params=ritual_params(params,...)
      local handler=params.handler
      local e=Effect.CreateEffect(handler)
      if params.desc then e:SetDescription(params.desc) end
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(Ritual.Target(params))
      e:SetOperation(Ritual.Operation(params))
      return e
    end
    function Ritual.AddProc(c,...)
      local params=ritual_params(c,...)
      local e=Ritual.CreateProc(params)
      local handler=params.handler
      if handler then handler:RegisterEffect(e) end
      return e
    end
    local function ritual_code_filter(...)
      local codes={...}
      return function(c)
        return #codes==0 or c:IsCode(table.unpack(codes))
      end
    end
    Ritual.AddProcGreater=aux.FunctionWithNamedArgs(function(c,filter,lv,desc,extrafil,extraop,matfilter,stage2,location,forcedselection,customoperation,specificmatfilter,requirementfunc,sumpos,extratg,self)
      return Ritual.AddProc({
        handler=c,lvtype=RITPROC_GREATER,filter=filter,lv=lv,desc=desc,extrafil=extrafil,extraop=extraop,
        matfilter=matfilter,stage2=stage2,location=location,forcedselection=forcedselection,customoperation=customoperation,
        specificmatfilter=specificmatfilter,requirementfunc=requirementfunc,sumpos=sumpos,extratg=extratg,self=self,
      })
    end,"handler","filter","lv","desc","extrafil","extraop","matfilter","stage2","location","forcedselection","customoperation","specificmatfilter","requirementfunc","sumpos","extratg","self")
    Ritual.AddProcEqual=aux.FunctionWithNamedArgs(function(c,filter,lv,desc,extrafil,extraop,matfilter,stage2,location,forcedselection,customoperation,specificmatfilter,requirementfunc,sumpos,extratg,self)
      return Ritual.AddProc({
        handler=c,lvtype=RITPROC_EQUAL,filter=filter,lv=lv,desc=desc,extrafil=extrafil,extraop=extraop,
        matfilter=matfilter,stage2=stage2,location=location,forcedselection=forcedselection,customoperation=customoperation,
        specificmatfilter=specificmatfilter,requirementfunc=requirementfunc,sumpos=sumpos,extratg=extratg,self=self,
      })
    end,"handler","filter","lv","desc","extrafil","extraop","matfilter","stage2","location","forcedselection","customoperation","specificmatfilter","requirementfunc","sumpos","extratg","self")
    function Ritual.AddProcGreaterCode(c,lv,desc,...)
      return Ritual.AddProc({handler=c,lvtype=RITPROC_GREATER,filter=ritual_code_filter(...),lv=lv,desc=desc})
    end
    function Ritual.AddProcEqualCode(c,lv,desc,...)
      return Ritual.AddProc({handler=c,lvtype=RITPROC_EQUAL,filter=ritual_code_filter(...),lv=lv,desc=desc})
    end
    function Ritual.AddWholeLevelTribute(c,condition)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_SINGLE)
      e:SetCode(EFFECT_RITUAL_LEVEL)
      e:SetValue(function(e,c,ritual_card)
        local lv=e:GetHandler():GetLevel()
        local rc=ritual_card or c
        if condition and rc and condition(rc,e) then
          return (lv<<16)|(rc:GetLevel() or lv)
        end
        return lv
      end)
      c:RegisterEffect(e)
      return e
    end
    aux.LinkProcedure=aux.LinkProcedure or Link or {}
    Link=aux.LinkProcedure
    function Link.AddProcedure(c,...)
      local mt=c:GetMetatable(false)
      if mt then mt.link_materials={...} end
    end
    aux.XyzProcedure=aux.XyzProcedure or Xyz or {}
    Xyz=aux.XyzProcedure
    function Xyz.AddProcedure(c,...)
      local mt=c:GetMetatable(false)
      if mt then mt.xyz_materials={...} end
    end
    aux.SynchroProcedure=aux.SynchroProcedure or Synchro or {}
    Synchro=aux.SynchroProcedure
    function Synchro.AddProcedure(c,...)
      local mt=c:GetMetatable(false)
      if mt then mt.synchro_materials={...} end
      return Effect.CreateEffect(c)
    end
    function Synchro.AddMajesticProcedure(c,...)
      local mt=c:GetMetatable(false)
      if mt then
        mt.synchro_type=2
        mt.synchro_materials={...}
      end
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetDescription(1172)
      e1:SetCode(EFFECT_SPSUMMON_PROC)
      e1:SetProperty(EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_IGNORE_IMMUNE)
      e1:SetRange(LOCATION_EXTRA)
      e1:SetValue(SUMMON_TYPE_SYNCHRO)
      c:RegisterEffect(e1)
      return e1
    end
    function Synchro.CreateHandMaterialEffect(c,id,material_filter,synchro_filter,banish_mats,rc)
      local e1=Effect.CreateEffect(rc or c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE)
      e1:SetCode(EFFECT_HAND_SYNCHRO)
      e1:SetRange(LOCATION_MZONE)
      e1:SetLabel(id or 0)
      e1:SetValue(function(e,tc,sc)
        if not tc or not tc:IsLocation(LOCATION_HAND) then return false end
        if material_filter and not material_filter(tc) then return false end
        if synchro_filter and not synchro_filter(sc) then return false end
        return true
      end)
      return e1
    end
    function Synchro.AddHandMaterialEffect(c,...)
      local e1=Synchro.CreateHandMaterialEffect(c,...)
      c:RegisterEffect(e1)
      return e1
    end
    Gemini=Gemini or {}
    function Gemini.AddProcedure(c)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(EFFECT_GEMINI_SUMMONABLE)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetProperty(EFFECT_FLAG_SINGLE_RANGE+EFFECT_FLAG_IGNORE_IMMUNE)
      e2:SetCode(EFFECT_ADD_TYPE)
      e2:SetRange(LOCATION_MZONE|LOCATION_GRAVE)
      e2:SetCondition(Gemini.NormalStatusCondition)
      e2:SetValue(TYPE_NORMAL)
      c:RegisterEffect(e2)
      local e3=e2:Clone()
      e3:SetCode(EFFECT_REMOVE_TYPE)
      e3:SetValue(TYPE_EFFECT)
      c:RegisterEffect(e3)
    end
    function Gemini.EffectStatusCondition(effect)
      local c=effect:GetHandler()
      return not c:IsDisabled() and c:IsGeminiStatus()
    end
    function Gemini.NormalStatusCondition(effect)
      local c=effect:GetHandler()
      return c:IsFaceup() and not c:IsGeminiStatus()
    end
    aux.EnableGeminiAttribute=Gemini.AddProcedure
    aux.IsGeminiState=Gemini.EffectStatusCondition
    aux.IsNotGeminiState=aux.NOT(Gemini.EffectStatusCondition)
    aux.GeminiNormalCondition=Gemini.NormalStatusCondition
    function Synchro.NonTuner(f,...)
      local params={...}
      return function(target,scard,sumtype,tp)
        return target:IsNotTuner(scard,tp) and (not f or f(target,table.unpack(params)))
      end
    end
    function Synchro.NonTunerEx(f,...)
      local params={...}
      return function(target,scard,sumtype,tp)
        return target:IsNotTuner(scard,tp) and (not f or f(target,table.unpack(params),scard,sumtype,tp))
      end
    end
    function Synchro.NonTunerEx2(f,...)
      local params={...}
      return function(target,scard,sumtype,tp)
        return target:IsNotTuner(scard,tp) and (not f or f(target,scard,sumtype,tp,table.unpack(params)))
      end
    end
    function Synchro.NonTunerCode(...)
      local codes={...}
      return function(target,scard,sumtype,tp)
        return target:IsNotTuner(scard,tp) and target:IsSummonCode(scard,sumtype,tp,table.unpack(codes))
      end
    end
    FLAG_ARMOR=FLAG_ARMOR or 110000103
    TYPE_PLUSMINUS=TYPE_PLUSMINUS or 0x60000000
    aux.ArmorProcedure=aux.ArmorProcedure or Armor or {}
    Armor=aux.ArmorProcedure
    function Armor.CannotAttack(e)
      return Duel.HasFlagEffect(e:GetHandlerPlayer(),FLAG_ARMOR) and Duel.GetFlagEffectLabel(e:GetHandlerPlayer(),FLAG_ARMOR)~=e:GetHandler():GetFieldID()
    end
    function Armor.AttackRegister(e,tp,eg,ep,ev,re,r,rp)
      Duel.RegisterFlagEffect(tp,FLAG_ARMOR,RESET_PHASE|PHASE_END,0,1,e:GetHandler():GetFieldID())
    end
    function Armor.RedirectAttackCondition(e,tp,eg,ep,ev,re,r,rp)
      local at=Duel.GetAttackTarget()
      return r~=REASON_REPLACE and at and at:IsFaceup() and at:IsControler(tp) and at:IsType(TYPE_ARMOR or 0)
    end
    function Armor.RedirectAttackFilter(c,code)
      return c:IsFaceup() and c:IsType(TYPE_ARMOR or 0) and not c:IsCode(code)
    end
    function Armor.RedirectAttackTarget(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
      local at=Duel.GetAttackTarget()
      local code=at and at:GetCode() or 0
      if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsControler(tp) and chkc~=at and Armor.RedirectAttackFilter(chkc,code) end
      if chk==0 then return at and Duel.IsExistingTarget(Armor.RedirectAttackFilter,tp,LOCATION_MZONE,0,1,at,code) end
      Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATTACKTARGET)
      Duel.SelectTarget(tp,Armor.RedirectAttackFilter,tp,LOCATION_MZONE,0,1,1,at,code)
    end
    function Armor.RedirectAttackOperation(e,tp,eg,ep,ev,re,r,rp)
      local tc=Duel.GetFirstTarget()
      if tc and tc:IsRelateToEffect(e) then Duel.ChangeAttackTarget(tc) end
    end
    function Armor.AddProcedure(c)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)
      e1:SetCondition(Armor.CannotAttack)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)
      e2:SetCode(EVENT_ATTACK_ANNOUNCE)
      e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e2:SetOperation(Armor.AttackRegister)
      c:RegisterEffect(e2)
      local e3=Effect.CreateEffect(c)
      e3:SetDescription(549)
      e3:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)
      e3:SetCode(EVENT_BE_BATTLE_TARGET)
      e3:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e3:SetRange(LOCATION_MZONE)
      e3:SetCondition(Armor.RedirectAttackCondition)
      e3:SetTarget(Armor.RedirectAttackTarget)
      e3:SetOperation(Armor.RedirectAttackOperation)
      c:RegisterEffect(e3)
      return e1,e2,e3
    end
    aux.PlusMinusProcedure=aux.PlusMinusProcedure or PlusMinus or {}
    PlusMinus=aux.PlusMinusProcedure
    function Card.IsPlusOrMinus(c)
      local tpe=c:GetType()&(TYPE_PLUSMINUS or 0)
      return tpe~=0 and tpe~=(TYPE_PLUSMINUS or 0)
    end
    function PlusMinus.nacon(e,tp,eg,ep,ev,re,r,rp)
      local c=e:GetHandler()
      local bc=c.GetBattleTarget and c:GetBattleTarget() or Duel.GetAttackTarget()
      return c:IsPlusOrMinus() and bc and bc:IsFaceup() and bc:IsType(c:GetType()&(TYPE_PLUSMINUS or 0))
    end
    function PlusMinus.naop(e,tp,eg,ep,ev,re,r,rp)
      Duel.NegateAttack()
    end
    function PlusMinus.attractcon(e)
      return e:GetHandler():IsPlusOrMinus()
    end
    function PlusMinus.attract(e,c)
      local handler=e:GetHandler()
      return c:IsFaceup() and c:IsType(handler:GetType()&(TYPE_PLUSMINUS or 0))
    end
    function PlusMinus.AddMagneticProcedure(c)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
      e1:SetCode(EVENT_ADJUST)
      e1:SetRange(LOCATION_MZONE)
      e1:SetCondition(PlusMinus.nacon)
      e1:SetOperation(PlusMinus.naop)
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_SINGLE)
      e2:SetCode(EFFECT_MUST_ATTACK)
      e2:SetCondition(PlusMinus.attractcon)
      c:RegisterEffect(e2)
      local e3=e2:Clone()
      e3:SetCode(EFFECT_MUST_ATTACK_MONSTER)
      e3:SetValue(PlusMinus.attract)
      c:RegisterEffect(e3)
      return e1,e2,e3
    end
    Pendulum=Pendulum or aux.PendulumProcedure or {}
    aux.PendulumProcedure=Pendulum
    Pendulum.AddProcedure=aux.FunctionWithNamedArgs(function(c,reg,desc)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_FIELD)
      e1:SetDescription(desc or 1163)
      e1:SetCode(EFFECT_SPSUMMON_PROC_G)
      e1:SetProperty(EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_CANNOT_DISABLE)
      e1:SetRange(LOCATION_PZONE)
      e1:SetCondition(function(e,sc,inchain,re,rp)
        if sc==nil then return true end
        return Duel.IsPlayerCanPendulumSummon(sc:GetControler())
      end)
      e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp,sc,sg,inchain)
        Duel.PendulumSummon(sc and sc:GetControler() or tp)
      end)
      e1:SetValue(SUMMON_TYPE_PENDULUM)
      c:RegisterEffect(e1)
      if reg==nil or reg then
        local e2=Effect.CreateEffect(c)
        e2:SetDescription(1160)
        e2:SetType(EFFECT_TYPE_ACTIVATE)
        e2:SetCode(EVENT_FREE_CHAIN)
        e2:SetRange(LOCATION_HAND)
        c:RegisterEffect(e2)
      end
    end,"handler","register","desc")
    function Pendulum.Filter(c,e,tp,lscale,rscale,lvchk)
      if lscale>rscale then lscale,rscale=rscale,lscale end
      local lv=c.pendulum_level or c:GetLevel()
      return (c:IsLocation(LOCATION_HAND) or (c:IsFaceup() and c:IsType(TYPE_PENDULUM)))
        and (lvchk or (lv>lscale and lv<rscale) or c:IsHasEffect(511004423))
        and c:IsCanBeSpecialSummoned(e,SUMMON_TYPE_PENDULUM,tp,false,false)
        and not c:IsForbidden()
    end
    function Pendulum.Condition()
      return function(e,c,inchain,re,rp)
        if c==nil then return true end
        return Duel.IsPlayerCanPendulumSummon(c:GetControler())
      end
    end
    function Pendulum.Operation()
      return function(e,tp,eg,ep,ev,re,r,rp,c,sg,inchain)
        Duel.PendulumSummon(c and c:GetControler() or tp)
      end
    end
    function Pendulum.PlayerCanGainAdditionalPendulumSummon(player,effect_flag)
      return Duel.IsTurnPlayer(player) and not Duel.IsPhase(PHASE_END)
        and not Duel.HasFlagEffect(player,CARD_ZEFRAATH)
        and not (effect_flag and Duel.HasFlagEffect(player,effect_flag))
    end
    function Pendulum.GrantAdditionalPendulumSummon(handler,condition,tp,locations,desc1,desc2,effect_flag)
      local player=tp or (handler and handler:GetControler()) or 0
      locations=locations or (LOCATION_HAND|LOCATION_EXTRA)
      if effect_flag and not Pendulum.PlayerCanGainAdditionalPendulumSummon(player,effect_flag) then return end
      if effect_flag then Duel.RegisterFlagEffect(player,effect_flag,RESET_PHASE|PHASE_END,0,1) end
      local harmonic_player=(locations&LOCATION_EXTRA)~=0 and 1-player or nil
      Duel.GrantAdditionalPendulumSummon(player,locations,1,condition,player,harmonic_player,LOCATION_EXTRA)
    end
    function Pendulum.CreateHarmonicOscillationEffect(handler,condition,desc,effect_flag,pendulum_flag)
      local player=(handler and handler:GetControler()) or 0
      local flag=pendulum_flag or CARD_ZEFRAATH
      if not Duel.HasFlagEffect(player,flag) then
        Duel.RegisterFlagEffect(player,flag,RESET_PHASE|PHASE_END,0,1)
        Duel.GrantAdditionalPendulumSummon(player,LOCATION_EXTRA,1,condition,1-player)
      end
      return {},{}
    end
${spiritProcedureSource}
    Cost=Cost or {}
    __duel_detach_costs=__duel_detach_costs or setmetatable({}, {__mode="k"})
    function Cost.DetachFromSelf(count,max,op)
      max=max or count
      local cost=function(e,tp,eg,ep,ev,re,r,rp,chk)
        local c=e:GetHandler()
        local min_count=type(count)=="function" and count(e,tp) or count
        local max_count=type(max)=="function" and max(e,tp) or max
        if chk==0 then return c and c:CheckRemoveOverlayCard(tp,min_count,REASON_COST) end
        if c:RemoveOverlayCard(tp,min_count,max_count,REASON_COST)>0 and op then op(e,Duel.GetOperatedGroup()) end
      end
      __duel_detach_costs[cost]=true
      return cost
    end
    function Card.SetSPSummonOnce(c,id)
      local mt=c:GetMetatable(false)
      if mt then mt.spsummon_once=id end
    end
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
      e0:SetValue(function(e,sum_eff,sum_p,sum_type) return sum_eff and sum_eff:IsHasType(EFFECT_TYPE_ACTIONS) or false end)
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
      e0:SetValue(aux.fusfirstlimit)
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
      e0:SetValue(aux.ritfirstlimit)
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
      e0:SetValue(aux.synfirstlimit)
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
      e0:SetValue(aux.xyzfirstlimit)
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
      e0:SetValue(aux.lnkfirstlimit)
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
      e0:SetValue(aux.penfirstlimit)
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
    function Card.EnableUnsummonable(c) local e0=c:EnableReviveLimit(); local e1=Effect.CreateEffect(c); e1:SetType(EFFECT_TYPE_SINGLE); e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE); e1:SetCode(EFFECT_CANNOT_SUMMON); c:RegisterEffect(e1); local e2=Effect.CreateEffect(c); e2:SetType(EFFECT_TYPE_SINGLE); e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_UNCOPYABLE); e2:SetCode(EFFECT_CANNOT_MSET); c:RegisterEffect(e2); return e0,e1,e2 end
    function Card.EnableGeminiStatus(c)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetCode(EFFECT_GEMINI_STATUS)
      c:RegisterEffect(e0)
      return e0
    end
    function Card.IsGeminiStatus(c)
      return (c:IsLocation(LOCATION_MZONE) and c:IsSummonLocation(LOCATION_MZONE) and c:IsSummonType(SUMMON_TYPE_GEMINI)) or c:IsHasEffect(EFFECT_GEMINI_STATUS)~=nil
    end
    Card.EnableGeminiState=Card.EnableGeminiStatus
    Card.IsGeminiState=Card.IsGeminiStatus
    function Card.EnableCounterPermit(c,counter_type,location,target)
      local mt=c:GetMetatable(false)
      if mt then
        mt.counter_place_list=mt.counter_place_list or {}
        table.insert(mt.counter_place_list,counter_type)
      end
      if location==nil then
        if c:IsMonster() then location=LOCATION_MZONE
        else location=LOCATION_SZONE|LOCATION_FZONE end
      end
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetCode(EFFECT_COUNTER_PERMIT+counter_type)
      e0:SetValue(location)
      if target then e0:SetTarget(target) end
      c:RegisterEffect(e0)
    end
    function Card.SetCounterLimit(c,counter_type,limit)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetCode(EFFECT_COUNTER_LIMIT+counter_type)
      e0:SetValue(limit)
      c:RegisterEffect(e0)
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
    aux.MaximumProcedure=aux.MaximumProcedure or Maximum or {}
    Maximum=aux.MaximumProcedure
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
    function Card.IsDoubleTribute(c,...)
      for _,flag in ipairs({...}) do
        if c:GetFlagEffect(flag)==0 then return false end
      end
      return true
    end
  `;
