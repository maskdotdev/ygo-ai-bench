import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installPersistentProcedureApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const source = `
    local player_all_value = PLAYER_ALL or 2
    local persistent_card_targets = persistent_card_targets or {}
    local function card_key(c)
      if not c then return nil end
      if c.GetFieldID then return "fid:" .. tostring(c:GetFieldID()) end
      return "code:" .. tostring(c:GetOriginalCode()) .. ":" .. tostring(c:GetControler()) .. ":" .. tostring(c:GetLocation()) .. ":" .. tostring(c:GetSequence())
    end
    local function ensure_card_target_api()
      if not Card or Card.SetCardTarget then return end
      function Card.SetCardTarget(c,tc)
        local key=card_key(c)
        local target_key=card_key(tc)
        if not key or not target_key then return false end
        persistent_card_targets[key]=persistent_card_targets[key] or {}
        persistent_card_targets[key][target_key]=true
        return true
      end
      function Card.IsHasCardTarget(c,tc)
        local key=card_key(c)
        local target_key=card_key(tc)
        return key and target_key and persistent_card_targets[key] and persistent_card_targets[key][target_key] or false
      end
      function Card.CreateRelation(c,tc,reset)
        if Card.SetCardTarget then return c:SetCardTarget(tc) end
        return false
      end
    end
    function aux.PersistentFilter(c,p,f,e,tp,tg,eg,ep,ev,re,r,rp)
      return (p==player_all_value or c:IsControler(p)) and (not f or f(c,e,tp)) and (not tg or tg(e,tp,eg,ep,ev,re,r,rp,c,0))
    end
    function aux.PersistentTarget(tg,p,f)
      return function(e,tp,eg,ep,ev,re,r,rp,chk,chkc)
        local player=nil
        if p==0 then
          player=tp
        elseif p==1 then
          player=1-tp
        elseif p==player_all_value or p==nil then
          player=player_all_value
        end
        if chkc then return chkc:IsLocation(LOCATION_MZONE) and chkc:IsFaceup() and aux.PersistentFilter(chkc,player,f,e,tp,tg,eg,ep,ev,re,r,rp) end
        if chk==0 then
          return player~=nil and Duel.IsExistingTarget(aux.PersistentFilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil,player,f,e,tp,tg,eg,ep,ev,re,r,rp)
        end
        Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_FACEUP)
        local g=Duel.SelectTarget(tp,aux.PersistentFilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil,player,f,e,tp)
        if tg then tg(e,tp,eg,ep,ev,re,r,rp,g:GetFirst(),1) end
      end
    end
    function aux.AddPersistentProcedure(c,p,f,category,property,hint1,hint2,con,cost,tg,op,anypos)
      ensure_card_target_api()
      local e1=Effect.CreateEffect(c)
      e1:SetDescription(1068)
      if category then e1:SetCategory(category) end
      e1:SetType(EFFECT_TYPE_ACTIVATE)
      e1:SetCode(EVENT_FREE_CHAIN)
      if hint1 or hint2 then
        if hint1==hint2 then e1:SetHintTiming(hint1)
        elseif hint1 and not hint2 then e1:SetHintTiming(hint1,0)
        elseif hint2 and not hint1 then e1:SetHintTiming(0,hint2)
        else e1:SetHintTiming(hint1,hint2) end
      end
      e1:SetProperty(EFFECT_FLAG_CARD_TARGET+(property or 0))
      if con then e1:SetCondition(con) end
      if cost then e1:SetCost(cost) end
      e1:SetTarget(aux.PersistentTarget(tg,p,f))
      if op then e1:SetOperation(op) end
      c:RegisterEffect(e1)
      local e2=Effect.CreateEffect(c)
      e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
      e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)
      e2:SetRange(LOCATION_SZONE)
      e2:SetCode(EVENT_CHAIN_SOLVED)
      e2:SetLabelObject(e1)
      e2:SetCondition(aux.PersistentTgCon)
      e2:SetOperation(aux.PersistentTgOp(anypos))
      c:RegisterEffect(e2)
      return e1,e2
    end
    function aux.PersistentTgCon(e,tp,eg,ep,ev,re,r,rp)
      return re==e:GetLabelObject()
    end
    function aux.PersistentTgOp(anypos)
      return function(e,tp,eg,ep,ev,re,r,rp)
        ensure_card_target_api()
        local c=e:GetHandler()
        local tc=nil
        local tg=Duel.GetChainInfo(ev or 0,CHAININFO_TARGET_CARDS)
        if tg and tg.GetFirst then tc=tg:GetFirst() end
        if not tc and Duel.GetFirstTarget then tc=Duel.GetFirstTarget() end
        if c:IsRelateToEffect(re) and tc and (anypos or tc:IsFaceup()) and tc:IsRelateToEffect(re) then
          c:SetCardTarget(tc)
          c:CreateRelation(tc,RESET_EVENT+RESETS_STANDARD)
        end
      end
    end
    function aux.PersistentTargetFilter(e,c)
      ensure_card_target_api()
      return e:GetHandler():IsHasCardTarget(c)
    end
  `;
  const status = lauxlib.luaL_dostring(L, to_luastring(source));
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
}
