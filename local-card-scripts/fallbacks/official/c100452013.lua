-- Starving Venom Fusion Dragon of the Four Heavenly Dragons
-- yugioh-deck-builder: local-fallback-provisional
local s,id=GetID()
function s.initial_effect(c)
  c:EnableReviveLimit()
  Fusion.AddProcMix(c,true,true,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_DARK),aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_DARK))
  -- Special Summoned: weaken and darken one other face-up monster.
  local e1=Effect.CreateEffect(c)
  e1:SetDescription(aux.Stringid(id,0))
  e1:SetCategory(CATEGORY_ATKCHANGE)
  e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
  e1:SetCode(EVENT_SPSUMMON_SUCCESS)
  e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY)
  e1:SetCountLimit(1,id)
  e1:SetTarget(s.atktg)
  e1:SetOperation(s.atkop)
  c:RegisterEffect(e1)
  -- Opponent chain Quick Effect Fusion Summon is intentionally omitted pending richer fusion-material support.
end
function s.atkfilter(c,e)
  return c:IsFaceup() and c:IsCanBeEffectTarget(e)
end
function s.atktg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
  if chkc then return chkc~=e:GetHandler() and chkc:IsLocation(LOCATION_MZONE) and s.atkfilter(chkc,e) end
  if chk==0 then return Duel.IsExistingTarget(s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,e:GetHandler(),e) end
  local g=Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,e:GetHandler(),e)
  Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,1,0,0)
end
function s.atkop(e,tp,eg,ep,ev,re,r,rp)
  local tc=Duel.GetFirstTarget()
  if tc and tc:IsRelateToEffect(e) and tc:IsFaceup() then
    local e1=Effect.CreateEffect(e:GetHandler())
    e1:SetType(EFFECT_TYPE_SINGLE)
    e1:SetCode(EFFECT_SET_ATTACK_FINAL)
    e1:SetValue(0)
    e1:SetReset(RESET_EVENT+RESETS_STANDARD)
    tc:RegisterEffect(e1)
    local e2=e1:Clone()
    e2:SetCode(EFFECT_CHANGE_ATTRIBUTE)
    e2:SetValue(ATTRIBUTE_DARK)
    tc:RegisterEffect(e2)
    local e3=e1:Clone()
    e3:SetCode(EFFECT_DISABLE)
    tc:RegisterEffect(e3)
  end
end
