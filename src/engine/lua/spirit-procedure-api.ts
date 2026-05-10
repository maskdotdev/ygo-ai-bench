export const spiritProcedureSource = `
    Spirit=Spirit or {}
    FLAG_SPIRIT_RETURN=FLAG_SPIRIT_RETURN or 2
    function Spirit.CommonCondition(e,tp,eg,ep,ev,re,r,rp)
      local c=e:GetHandler()
      return c:HasFlagEffect(FLAG_SPIRIT_RETURN) and not c:IsHasEffect(EFFECT_SPIRIT_DONOT_RETURN)
    end
    function Spirit.MandatoryReturnCondition(e,tp,eg,ep,ev,re,r,rp)
      return Spirit.CommonCondition(e,tp,eg,ep,ev,re,r,rp) and not e:GetHandler():IsHasEffect(EFFECT_SPIRIT_MAYNOT_RETURN)
    end
    function Spirit.MandatoryReturnTarget(e,tp,eg,ep,ev,re,r,rp,chk)
      if chk==0 then return true end
      local c=e:GetHandler()
      c:ResetFlagEffect(FLAG_SPIRIT_RETURN)
      Duel.SetOperationInfo(0,CATEGORY_TOHAND,c,1,0,0)
    end
    function Spirit.OptionalReturnCondition(e,tp,eg,ep,ev,re,r,rp)
      return Spirit.CommonCondition(e,tp,eg,ep,ev,re,r,rp) and e:GetHandler():IsHasEffect(EFFECT_SPIRIT_MAYNOT_RETURN)~=nil
    end
    function Spirit.OptionalReturnTarget(e,tp,eg,ep,ev,re,r,rp,chk)
      local c=e:GetHandler()
      if chk==0 then return c:IsAbleToHand() end
      c:ResetFlagEffect(FLAG_SPIRIT_RETURN)
      Duel.SetOperationInfo(0,CATEGORY_TOHAND,c,1,0,0)
    end
    function Spirit.ReturnOperation(e,tp,eg,ep,ev,re,r,rp)
      local c=e:GetHandler()
      if c:IsRelateToEffect(e) then Duel.SendtoHand(c,nil,REASON_EFFECT) end
    end
    function Spirit.AddProcedure(c,...)
      local e1=Effect.CreateEffect(c)
      e1:SetDescription(1105)
      e1:SetCategory(CATEGORY_TOHAND)
      e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F)
      e1:SetCode(EVENT_PHASE+PHASE_END)
      e1:SetRange(LOCATION_MZONE)
      e1:SetCondition(Spirit.MandatoryReturnCondition)
      e1:SetTarget(Spirit.MandatoryReturnTarget)
      e1:SetOperation(Spirit.ReturnOperation)
      c:RegisterEffect(e1)
      local e2=e1:Clone()
      e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)
      e2:SetCondition(Spirit.OptionalReturnCondition)
      e2:SetTarget(Spirit.OptionalReturnTarget)
      c:RegisterEffect(e2)
      local feffs={}
      for _,event in ipairs{...} do
        local fe1=Effect.CreateEffect(c)
        fe1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_CONTINUOUS)
        fe1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
        fe1:SetCode(event)
        fe1:SetOperation(function(e) e:GetHandler():RegisterFlagEffect(FLAG_SPIRIT_RETURN,RESET_EVENT+RESETS_STANDARD,0,1) end)
        c:RegisterEffect(fe1)
        table.insert(feffs,fe1)
      end
      local fe2=Effect.CreateEffect(c)
      fe2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
      fe2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      fe2:SetCode(EVENT_TURN_END)
      fe2:SetRange(LOCATION_MZONE)
      fe2:SetOperation(function(e) e:GetHandler():ResetFlagEffect(FLAG_SPIRIT_RETURN) end)
      c:RegisterEffect(fe2)
      table.insert(feffs,fe2)
      return e1,e2,table.unpack(feffs)
    end
`;
