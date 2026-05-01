-- Skull Archfiend of Chaos
-- yugioh-deck-builder: local-fallback-provisional
local s,id=GetID()
function s.initial_effect(c)
  -- Recycle 3 cards, including a card that mentions "Ritual of Light and Darkness", then Special Summon.
  local e1=Effect.CreateEffect(c)
  e1:SetDescription(aux.Stringid(id,0))
  e1:SetCategory(CATEGORY_TODECK+CATEGORY_SPECIAL_SUMMON)
  e1:SetType(EFFECT_TYPE_IGNITION)
  e1:SetRange(LOCATION_HAND+LOCATION_GRAVE)
  e1:SetCountLimit(1,id)
  e1:SetTarget(s.sptg)
  e1:SetOperation(s.spop)
  c:RegisterEffect(e1)
  -- Sent to GY: send Ritual Spell and search listed Ritual Monster.
  local e2=Effect.CreateEffect(c)
  e2:SetDescription(aux.Stringid(id,1))
  e2:SetCategory(CATEGORY_TOGRAVE+CATEGORY_TOHAND+CATEGORY_SEARCH)
  e2:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
  e2:SetCode(EVENT_TO_GRAVE)
  e2:SetProperty(EFFECT_FLAG_DELAY)
  e2:SetCountLimit(1,{id,1})
  e2:SetTarget(s.thtg)
  e2:SetOperation(s.thop)
  c:RegisterEffect(e2)
end
function s.mention(c)
  return c:IsCode(33599853) or c:ListsCode(33599853)
end
function s.recyclefilter(c)
  return c:IsAbleToDeck()
end
function s.sptg(e,tp,eg,ep,ev,re,r,rp,chk)
  local c=e:GetHandler()
  if chk==0 then
    return Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and c:IsCanBeSpecialSummoned(e,0,tp,false,false)
      and Duel.IsExistingMatchingCard(s.mention,tp,LOCATION_GRAVE+LOCATION_REMOVED,LOCATION_GRAVE+LOCATION_REMOVED,1,c)
      and Duel.GetMatchingGroupCount(s.recyclefilter,tp,LOCATION_GRAVE+LOCATION_REMOVED,LOCATION_GRAVE+LOCATION_REMOVED,c)>=3
  end
  Duel.SetOperationInfo(0,CATEGORY_TODECK,nil,3,PLAYER_ALL,LOCATION_GRAVE+LOCATION_REMOVED)
  Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,0,0)
end
function s.spop(e,tp,eg,ep,ev,re,r,rp)
  local c=e:GetHandler()
  if not c:IsRelateToEffect(e) then return end
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TODECK)
  local g=Duel.SelectMatchingCard(tp,s.recyclefilter,tp,LOCATION_GRAVE+LOCATION_REMOVED,LOCATION_GRAVE+LOCATION_REMOVED,3,3,c)
  if g:GetCount()==3 and Duel.SendtoDeck(g,nil,SEQ_DECKBOTTOM,REASON_EFFECT)>0 then
    Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP_ATTACK)
  end
end
function s.ritualspell(c)
  return c:IsCode(33599853) and c:IsAbleToGrave()
end
function s.ritualmonster(c)
  return (c:IsCode(70405001) or c:IsCode(44001993)) and c:IsAbleToHand()
end
function s.thtg(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return Duel.IsExistingMatchingCard(s.ritualspell,tp,LOCATION_HAND+LOCATION_DECK,0,1,nil) and Duel.IsExistingMatchingCard(s.ritualmonster,tp,LOCATION_DECK,0,1,nil) end
end
function s.thop(e,tp,eg,ep,ev,re,r,rp)
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOGRAVE)
  local sg=Duel.SelectMatchingCard(tp,s.ritualspell,tp,LOCATION_HAND+LOCATION_DECK,0,1,1,nil)
  if sg:GetCount()>0 and Duel.SendtoGrave(sg,REASON_EFFECT)>0 then
    Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
    local tg=Duel.SelectMatchingCard(tp,s.ritualmonster,tp,LOCATION_DECK,0,1,1,nil)
    if tg:GetCount()>0 then Duel.SendtoHand(tg,nil,REASON_EFFECT) end
  end
end
