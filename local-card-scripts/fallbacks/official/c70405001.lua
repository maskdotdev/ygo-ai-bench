-- Black Luster Soldier - Soldier of Light and Darkness
-- yugioh-deck-builder: local-fallback-provisional
local s,id=GetID()
function s.initial_effect(c)
  c:EnableReviveLimit()
  c:AddMustFirstBeRitualSummoned()
  -- Cannot be destroyed by battle.
  local e0=Effect.CreateEffect(c)
  e0:SetType(EFFECT_TYPE_SINGLE)
  e0:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)
  e0:SetValue(1)
  c:RegisterEffect(e0)
  -- Special Summoned: banish 1 opponent card.
  local e1=Effect.CreateEffect(c)
  e1:SetDescription(aux.Stringid(id,0))
  e1:SetCategory(CATEGORY_REMOVE)
  e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
  e1:SetCode(EVENT_SPSUMMON_SUCCESS)
  e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DELAY)
  e1:SetCountLimit(1,id)
  e1:SetTarget(s.rmtg)
  e1:SetOperation(s.rmop)
  c:RegisterEffect(e1)
  -- Battle-destroy trigger is omitted pending extra-attack grant support.
end
s.listed_names={33599853}
function s.rmfilter(c,e)
  return c:IsAbleToRemove() and c:IsCanBeEffectTarget(e)
end
function s.rmtg(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
  if chkc then return chkc:IsControler(1-tp) and chkc:IsOnField() and s.rmfilter(chkc,e) end
  if chk==0 then return Duel.IsExistingTarget(s.rmfilter,tp,0,LOCATION_ONFIELD,1,nil,e) end
  local g=Duel.SelectTarget(tp,s.rmfilter,tp,0,LOCATION_ONFIELD,1,1,nil,e)
  Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,1,0,0)
end
function s.rmop(e,tp,eg,ep,ev,re,r,rp)
  local tc=Duel.GetFirstTarget()
  if tc and tc:IsRelateToEffect(e) then Duel.Remove(tc,POS_FACEUP,REASON_EFFECT) end
end
