-- Mind Shuffle
-- yugioh-deck-builder: local-fallback-provisional
local s,id=GetID()
function s.initial_effect(c)
  -- Activate
  local e0=Effect.CreateEffect(c)
  e0:SetType(EFFECT_TYPE_ACTIVATE)
  e0:SetCode(EVENT_FREE_CHAIN)
  c:RegisterEffect(e0)
  -- Search then discard.
  local e1=Effect.CreateEffect(c)
  e1:SetDescription(aux.Stringid(id,0))
  e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH+CATEGORY_HANDES)
  e1:SetType(EFFECT_TYPE_QUICK_O)
  e1:SetCode(EVENT_FREE_CHAIN)
  e1:SetRange(LOCATION_SZONE)
  e1:SetCountLimit(1,id)
  e1:SetTarget(s.thtg)
  e1:SetOperation(s.thop)
  c:RegisterEffect(e1)
  -- Chain replacement summon.
  local e2=Effect.CreateEffect(c)
  e2:SetDescription(aux.Stringid(id,1))
  e2:SetCategory(CATEGORY_TOHAND+CATEGORY_SPECIAL_SUMMON)
  e2:SetType(EFFECT_TYPE_QUICK_O)
  e2:SetCode(EVENT_CHAINING)
  e2:SetRange(LOCATION_SZONE)
  e2:SetCountLimit(1,{id,1})
  e2:SetTarget(s.sptg)
  e2:SetOperation(s.spop)
  c:RegisterEffect(e2)
end
s.listed_names={33599853}
function s.thfilter(c)
  return c:IsMonster() and c:ListsCode(33599853) and c:IsAbleToHand()
end
function s.thtg(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return Duel.IsExistingMatchingCard(s.thfilter,tp,LOCATION_DECK,0,1,nil) and Duel.IsPlayerCanDiscardHand(tp,1) end
  Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)
end
function s.thop(e,tp,eg,ep,ev,re,r,rp)
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
  local g=Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)
  if g:GetCount()>0 and Duel.SendtoHand(g,nil,REASON_EFFECT)>0 then
    Duel.DiscardHand(tp,nil,1,1,REASON_EFFECT+REASON_DISCARD)
  end
end
function s.retfilter(c)
  return c:IsFaceup() and c:IsLevelAbove(7) and c:IsAbleToHand()
end
function s.spfilter(c,e,tp,code)
  return c:ListsCode(33599853) and not c:IsCode(code) and c:IsCanBeSpecialSummoned(e,0,tp,true,false)
end
function s.sptg(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(s.retfilter,tp,LOCATION_MZONE,0,1,nil) end
end
function s.spop(e,tp,eg,ep,ev,re,r,rp)
  if Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return end
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_RTOHAND)
  local rc=Duel.SelectMatchingCard(tp,s.retfilter,tp,LOCATION_MZONE,0,1,1,nil):GetFirst()
  if not rc then return end
  local code=rc:GetCode()
  if Duel.SendtoHand(rc,nil,REASON_EFFECT)==0 then return end
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
  local g=Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp,code)
  if g:GetCount()>0 then Duel.SpecialSummon(g,0,tp,tp,true,false,POS_FACEUP_ATTACK) end
end
