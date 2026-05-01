-- Ritual of Light and Darkness
-- yugioh-deck-builder: local-fallback-provisional
local s,id=GetID()
function s.initial_effect(c)
  -- Ritual Summon Black Chaos or Black Luster Soldier.
  local e1=Effect.CreateEffect(c)
  e1:SetDescription(aux.Stringid(id,0))
  e1:SetCategory(CATEGORY_SPECIAL_SUMMON)
  e1:SetType(EFFECT_TYPE_ACTIVATE)
  e1:SetCode(EVENT_FREE_CHAIN)
  e1:SetTarget(s.target)
  e1:SetOperation(s.activate)
  c:RegisterEffect(e1)
  -- GY: add this and another card that mentions it.
  local e2=Effect.CreateEffect(c)
  e2:SetDescription(aux.Stringid(id,1))
  e2:SetCategory(CATEGORY_TOHAND)
  e2:SetType(EFFECT_TYPE_IGNITION)
  e2:SetRange(LOCATION_GRAVE)
  e2:SetCountLimit(1,{id,1})
  e2:SetTarget(s.gytg)
  e2:SetOperation(s.gyop)
  c:RegisterEffect(e2)
end
s.listed_names={70405001,44001993}
function s.ritualfilter(c,e,tp,mg)
  return (c:IsCode(70405001) or c:IsCode(44001993))
    and c:IsCanBeSpecialSummoned(e,SUMMON_TYPE_RITUAL,tp,true,false)
    and mg:CheckWithSumGreater(function(mc) return mc:GetRitualLevel(c) end,c:GetLevel(),1,c:GetLevel())
end
function s.matfilter(c)
  return c:IsMonster() and c:IsAbleToGrave()
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
  local mg=Duel.GetRitualMaterial(tp):Filter(s.matfilter,e:GetHandler())
  if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
    and Duel.IsExistingMatchingCard(s.ritualfilter,tp,LOCATION_HAND,0,1,nil,e,tp,mg) end
  Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
  if Duel.GetLocationCount(tp,LOCATION_MZONE)<=0 then return end
  local mg=Duel.GetRitualMaterial(tp):Filter(s.matfilter,e:GetHandler())
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_SPSUMMON)
  local rc=Duel.SelectMatchingCard(tp,s.ritualfilter,tp,LOCATION_HAND,0,1,1,nil,e,tp,mg):GetFirst()
  if not rc then return end
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_RELEASE)
  mg=mg:SelectWithSumGreater(tp,function(mc) return mc:GetRitualLevel(rc) end,rc:GetLevel(),1,rc:GetLevel())
  if mg:GetCount()>0 then
    Duel.RitualSummon(rc,mg)
  end
end
function s.gyfilter(c)
  return c:ListsCode(33599853) and c:IsAbleToHand()
end
function s.gytg(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return e:GetHandler():IsAbleToHand() and Duel.IsExistingMatchingCard(s.gyfilter,tp,LOCATION_GRAVE,0,1,e:GetHandler()) end
  Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,2,tp,LOCATION_GRAVE)
end
function s.gyop(e,tp,eg,ep,ev,re,r,rp)
  local c=e:GetHandler()
  if not c:IsRelateToEffect(e) then return end
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
  local g=Duel.SelectMatchingCard(tp,s.gyfilter,tp,LOCATION_GRAVE,0,1,1,c)
  if g:GetCount()>0 then
    g:AddCard(c)
    Duel.SendtoHand(g,nil,REASON_EFFECT)
  end
end
