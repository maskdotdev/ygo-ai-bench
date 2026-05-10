import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installUnionProcedureApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const source = `
    local union_old_rules = union_old_rules or {}
    local union_old_rule_codes = union_old_rule_codes or {}
    local union_limit_values = union_limit_values or {}
    local union_limit_code_values = union_limit_code_values or {}
    local function card_key(c)
      if not c then return nil end
      if c.GetFieldID then return "fid:" .. tostring(c:GetFieldID()) end
      return "code:" .. tostring(c:GetOriginalCode()) .. ":" .. tostring(c:GetControler()) .. ":" .. tostring(c:GetLocation()) .. ":" .. tostring(c:GetSequence())
    end
    local function ensure_union_card_api()
      if not Card then return end
      if not Card.GetUnionCount then
        function Card.GetUnionCount(c)
          local old_count=0
          local new_count=0
          local group=c:GetEquipGroup()
          for ec in aux.Next(group) do
            if ec:IsHasEffect(EFFECT_UNION_STATUS) then new_count=new_count+1 end
            if ec:IsHasEffect(EFFECT_OLDUNION_STATUS) then old_count=old_count+1 end
          end
          return old_count,new_count
        end
      end
      if not Card.GetCardEffect then
        function Card.GetCardEffect(c,code)
          return c:IsHasEffect(code)
        end
      end
      if not Card.CheckUnionTarget then
        function Card.CheckUnionTarget(c,tc)
          local value=union_limit_values[card_key(c)] or union_limit_code_values[c:GetOriginalCode()]
          return not value or value(nil,tc)
        end
      end
    end
    function aux.UnionFilter(c,f,oldrule)
      ensure_union_card_api()
      local ct1,ct2=Card.GetUnionCount(c)
      if c:IsFaceup() and (not f or f(c)) then
        if oldrule then return ct1==0 end
        return ct2==0
      end
      return false
    end
    function aux.UnionTarget(f,oldrule)
      return function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        local c=e:GetHandler()
        local code=c:GetOriginalCode()
        if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsControler(tp) and aux.UnionFilter(chkc,f,oldrule) end
        if chk==0 then
          return c:GetFlagEffect(code)==0 and Duel.GetLocationCount(tp,LOCATION_SZONE)>0 and Duel.IsExistingTarget(aux.UnionFilter,tp,LOCATION_MZONE,0,1,c,f,oldrule)
        end
        Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_EQUIP)
        local g=Duel.SelectTarget(tp,aux.UnionFilter,tp,LOCATION_MZONE,0,1,1,c,f,oldrule)
        Duel.SetOperationInfo(0,CATEGORY_EQUIP,g,1,0,0)
        c:RegisterFlagEffect(code,RESET_EVENT+(RESETS_STANDARD-RESET_TOFIELD-RESET_LEAVE)+RESET_PHASE+PHASE_END,0,1)
      end
    end
    function aux.UnionOperation(f)
      return function(e,tp,eg,ep,ev,re,r,rp)
        local c=e:GetHandler()
        local tc=Duel.GetFirstTarget()
        if not c:IsRelateToEffect(e) or c:IsFacedown() then return end
        if not tc or not tc:IsRelateToEffect(e) or (f and not f(tc)) then
          Duel.SendtoGrave(c,REASON_EFFECT)
          return
        end
        if not Duel.Equip(tp,c,tc,false) then return end
        aux.SetUnionState(c)
      end
    end
    function aux.UnionSumTarget(oldrule)
      return function(e,tp,eg,ep,ev,re,r,rp,chk)
        local c=e:GetHandler()
        local code=c:GetOriginalCode()
        local pos=POS_FACEUP
        if oldrule then pos=POS_FACEUP_ATTACK end
        if chk==0 then return c:GetFlagEffect(code)==0 and Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and c:IsCanBeSpecialSummoned(e,0,tp,true,false,pos) end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,0)
        c:RegisterFlagEffect(code,RESET_EVENT+(RESETS_STANDARD-RESET_TOFIELD-RESET_LEAVE)+RESET_PHASE+PHASE_END,0,1)
      end
    end
    function aux.UnionSumOperation(oldrule)
      return function(e,tp,eg,ep,ev,re,r,rp)
        local c=e:GetHandler()
        if not c:IsRelateToEffect(e) then return end
        local pos=POS_FACEUP
        if oldrule then pos=POS_FACEUP_ATTACK end
        if Duel.SpecialSummon(c,0,tp,tp,true,false,pos)==0 and Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 and c:IsCanBeSpecialSummoned(e,0,tp,true,false,pos) then
          Duel.SendtoGrave(c,REASON_RULE)
        end
      end
    end
    function aux.UnionReplace(oldrule)
      return function(e,re,r,rp)
        if oldrule then return (r&REASON_BATTLE)~=0 end
        return (r&REASON_BATTLE)~=0 or (r&REASON_EFFECT)~=0
      end
    end
    function aux.UnionLimit(f)
      return function(e,c)
        return (not f or f(c)) or e:GetHandler():GetEquipTarget()==c
      end
    end
    function aux.IsUnionState(effect)
      return effect:GetHandler():IsHasEffect(EFFECT_UNION_STATUS)~=nil
    end
    function aux.SetUnionState(c)
      ensure_union_card_api()
      local key=card_key(c)
      local value=union_limit_values[key] or union_limit_code_values[c:GetOriginalCode()] or aux.UnionLimit(nil)
      local e0=Effect.CreateEffect(c)
      e0:SetType(EFFECT_TYPE_SINGLE)
      e0:SetCode(EFFECT_EQUIP_LIMIT)
      e0:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e0:SetValue(value)
      e0:SetReset(RESET_EVENT+RESETS_STANDARD)
      c:RegisterEffect(e0)
      local e1=Effect.CreateEffect(c)
      e1:SetType(EFFECT_TYPE_SINGLE)
      e1:SetCode(EFFECT_UNION_STATUS)
      e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e1:SetReset(RESET_EVENT+RESETS_STANDARD)
      c:RegisterEffect(e1)
      if union_old_rules[key] or union_old_rule_codes[c:GetOriginalCode()] then
        local e2=e1:Clone()
        e2:SetCode(EFFECT_OLDUNION_STATUS)
        c:RegisterEffect(e2)
      end
      return e1
    end
    function aux.CheckUnionEquip(uc,tc,ign_ct)
      ensure_union_card_api()
      local ct1,ct2=Card.GetUnionCount(tc)
      local ignored=ign_ct or 0
      if union_old_rules[card_key(uc)] or union_old_rule_codes[uc:GetOriginalCode()] then return ct1<=ignored end
      return ct2<=ignored
    end
    function aux.AddUnionProcedure(c,f,oldequip,oldprotect)
      ensure_union_card_api()
      if oldprotect==nil then oldprotect=oldequip end
      local e1=Effect.CreateEffect(c)
      e1:SetDescription(1068)
      e1:SetCategory(CATEGORY_EQUIP)
      e1:SetProperty(EFFECT_FLAG_CARD_TARGET)
      e1:SetType(EFFECT_TYPE_IGNITION)
      e1:SetRange(LOCATION_MZONE)
      e1:SetTarget(aux.UnionTarget(f,oldequip))
      e1:SetOperation(aux.UnionOperation(f))
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetDescription(2)
      e2:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e2:SetType(EFFECT_TYPE_IGNITION)
      e2:SetRange(LOCATION_SZONE)
      if oldequip then e2:SetCondition(aux.IsUnionState)
      else e2:SetCondition(function(e) return e:GetHandler():GetEquipTarget() end) end
      e2:SetTarget(aux.UnionSumTarget(oldequip))
      e2:SetOperation(aux.UnionSumOperation(oldequip))
      c:RegisterEffect(e2)
      local e3=Effect.CreateEffect(c)
      e3:SetType(EFFECT_TYPE_EQUIP)
      e3:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
      e3:SetCode(EFFECT_DESTROY_SUBSTITUTE)
      if oldprotect then e3:SetCondition(aux.IsUnionState)
      else e3:SetCondition(function(e) return e:GetHandler():GetEquipTarget() end) end
      e3:SetValue(aux.UnionReplace(oldprotect))
      c:RegisterEffect(e3)
      local e4=Effect.CreateEffect(c)
      e4:SetType(EFFECT_TYPE_SINGLE)
      e4:SetCode(EFFECT_UNION_LIMIT)
      e4:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      local value=aux.UnionLimit(f)
      e4:SetValue(value)
      c:RegisterEffect(e4)
      local key=card_key(c)
      union_limit_values[key]=value
      union_limit_code_values[c:GetOriginalCode()]=value
      if oldequip then
        union_old_rules[key]=true
        union_old_rule_codes[c:GetOriginalCode()]=true
      end
      return e1,e2,e3,e4
    end
  `;
  const status = lauxlib.luaL_dostring(L, to_luastring(source));
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
}
