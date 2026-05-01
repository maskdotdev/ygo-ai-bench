-- Black Chaos the Ultimate Magical Swordsman
-- yugioh-deck-builder: local-fallback-provisional
local s,id=GetID()
function s.initial_effect(c)
  c:EnableReviveLimit()
  c:AddCannotBeNormalSummoned()
  -- Special Summon itself by returning a Ritual Spellcaster/Warrior from hand/GY.
  local e0=Effect.CreateEffect(c)
  e0:SetType(EFFECT_TYPE_FIELD)
  e0:SetCode(EFFECT_SPSUMMON_PROC)
  e0:SetProperty(EFFECT_FLAG_UNCOPYABLE)
  e0:SetRange(LOCATION_HAND)
  e0:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)
  e0:SetCondition(s.spcon)
  e0:SetOperation(s.spop)
  c:RegisterEffect(e0)
  -- Discard this card; place "Mind Shuffle" from Deck/GY.
  local e1=Effect.CreateEffect(c)
  e1:SetDescription(aux.Stringid(id,0))
  e1:SetType(EFFECT_TYPE_IGNITION)
  e1:SetRange(LOCATION_HAND)
  e1:SetCountLimit(1,{id,1})
  e1:SetCost(s.plcost)
  e1:SetTarget(s.pltg)
  e1:SetOperation(s.plop)
  c:RegisterEffect(e1)
  -- Banish 2 opponent cards.
  local e2=Effect.CreateEffect(c)
  e2:SetDescription(aux.Stringid(id,1))
  e2:SetCategory(CATEGORY_REMOVE)
  e2:SetType(EFFECT_TYPE_IGNITION)
  e2:SetRange(LOCATION_MZONE)
  e2:SetCountLimit(1,{id,2})
  e2:SetTarget(s.rmtg)
  e2:SetOperation(s.rmop)
  c:RegisterEffect(e2)
end
function s.spfilter(c)
  return c:IsType(TYPE_RITUAL) and (c:IsRace(RACE_SPELLCASTER) or c:IsRace(RACE_WARRIOR)) and c:IsAbleToDeckOrExtraAsCost()
end
function s.spcon(e,c)
  if c==nil then return true end
  return Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0
    and Duel.IsExistingMatchingCard(s.spfilter,c:GetControler(),LOCATION_HAND+LOCATION_GRAVE,0,1,c)
end
function s.spop(e,tp,eg,ep,ev,re,r,rp,c)
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TODECK)
  local g=Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND+LOCATION_GRAVE,0,1,1,c)
  Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_COST)
end
function s.plcost(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return e:GetHandler():IsDiscardable() end
  Duel.SendtoGrave(e:GetHandler(),REASON_COST+REASON_DISCARD)
end
function s.plfilter(c)
  return c:IsCode(24749710) and not c:IsForbidden()
end
function s.pltg(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return Duel.GetLocationCount(tp,LOCATION_SZONE)>0 and Duel.IsExistingMatchingCard(s.plfilter,tp,LOCATION_DECK+LOCATION_GRAVE,0,1,nil) end
end
function s.plop(e,tp,eg,ep,ev,re,r,rp)
  if Duel.GetLocationCount(tp,LOCATION_SZONE)<=0 then return end
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOFIELD)
  local tc=Duel.SelectMatchingCard(tp,s.plfilter,tp,LOCATION_DECK+LOCATION_GRAVE,0,1,1,nil):GetFirst()
  if tc then Duel.MoveToField(tc,tp,tp,LOCATION_SZONE,POS_FACEUP,true) end
end
function s.rmfilter(c)
  return c:IsAbleToRemove()
end
function s.rmtg(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return Duel.IsExistingMatchingCard(s.rmfilter,tp,0,LOCATION_ONFIELD,2,nil) end
  local g=Duel.SelectMatchingCard(tp,s.rmfilter,tp,0,LOCATION_ONFIELD,2,2,nil)
  Duel.SetTargetCard(g)
  Duel.SetOperationInfo(0,CATEGORY_REMOVE,g,2,0,0)
end
function s.rmop(e,tp,eg,ep,ev,re,r,rp)
  local g=Duel.GetTargetCards(e)
  if g:GetCount()>0 then Duel.Remove(g,POS_FACEUP,REASON_EFFECT) end
end
