-- Chaos Hats
-- yugioh-deck-builder: local-fallback-provisional
local s,id=GetID()
function s.initial_effect(c)
  -- Rewrite an opponent effect and hide a mentioned monster among face-down Spell/Trap decoys.
  local e1=Effect.CreateEffect(c)
  e1:SetDescription(aux.Stringid(id,0))
  e1:SetType(EFFECT_TYPE_ACTIVATE)
  e1:SetCode(EVENT_CHAINING)
  e1:SetCondition(s.condition)
  e1:SetTarget(s.target)
  e1:SetOperation(s.activate)
  c:RegisterEffect(e1)
end
function s.condition(e,tp,eg,ep,ev,re,r,rp)
  return rp==1-tp
end
function s.filter(c)
  return c:IsFaceup() and c:IsLocation(LOCATION_MZONE) and c:ListsCode(33599853)
end
function s.stfilter(c)
  return c:ListsCode(33599853) and c:IsSpellTrap() and not c:IsForbidden()
end
function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
  if chk==0 then return Duel.GetLocationCount(tp,LOCATION_MZONE)>0
    and Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,1,nil)
    and Duel.IsExistingMatchingCard(s.stfilter,tp,LOCATION_DECK,0,1,nil) end
end
function s.activate(e,tp,eg,ep,ev,re,r,rp)
  if ev then
    Duel.ChangeChainOperation(ev,function() end)
  end
  Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_POSCHANGE)
  local tc=Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil):GetFirst()
  if not tc or Duel.ChangePosition(tc,POS_FACEDOWN_DEFENSE)==0 then return end
  local g=Group.FromCards(tc)
  local ct=math.min(Duel.GetLocationCount(tp,LOCATION_MZONE),2)
  if ct>0 then
    Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_TOFIELD)
    local sg=Duel.SelectMatchingCard(tp,s.stfilter,tp,LOCATION_DECK,0,1,ct,nil)
    for sc in aux.Next(sg) do
      if Duel.MoveToField(sc,tp,tp,LOCATION_MZONE,POS_FACEDOWN_DEFENSE,true)>0 then
        g:AddCard(sc)
      end
    end
  end
  Duel.ShuffleSetCard(g)
end
