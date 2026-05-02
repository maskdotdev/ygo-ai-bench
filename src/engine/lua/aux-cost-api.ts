import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installAuxCostApi(L: unknown, readLuaError: (state: unknown) => string): void {
  const source = `
    Cost=Cost or {}
    function Cost.SelfBanish(e,tp,eg,ep,ev,re,r,rp,chk)
      local c=e:GetHandler()
      if chk==0 then return c and c:IsAbleToRemoveAsCost() end
      Duel.Remove(c,POS_FACEUP,REASON_COST)
    end
    function Cost.SelfReveal(e,tp,eg,ep,ev,re,r,rp,chk)
      local c=e:GetHandler()
      if chk==0 then return c and not c:IsPublic() end
      Duel.ConfirmCards(1-tp,c)
      if c:IsLocation(LOCATION_HAND) then Duel.ShuffleHand(tp) end
      if c:IsLocation(LOCATION_DECK) then Duel.ShuffleDeck(tp) end
      if c:IsLocation(LOCATION_EXTRA) then Duel.ShuffleExtra(tp) end
    end
    function Cost.SelfToHand(e,tp,eg,ep,ev,re,r,rp,chk)
      local c=e:GetHandler()
      if chk==0 then return c and c:IsAbleToHandAsCost() end
      Duel.SendtoHand(c,nil,REASON_COST)
    end
    function Cost.SelfToDeck(e,tp,eg,ep,ev,re,r,rp,chk)
      local c=e:GetHandler()
      if chk==0 then return c and c:IsAbleToDeckAsCost() end
      Duel.SendtoDeck(c,nil,SEQ_DECKSHUFFLE or 2,REASON_COST)
    end
    function Cost.SelfToExtra(e,tp,eg,ep,ev,re,r,rp,chk)
      local c=e:GetHandler()
      if chk==0 then return c and c:IsAbleToExtra() end
      Duel.SendtoExtra(c,nil,REASON_COST)
    end
    function Cost.PayLP(lp_value,pay_until)
      if not pay_until then
        if lp_value>=1 then
          return function(e,tp,eg,ep,ev,re,r,rp,chk)
            if chk==0 then return Duel.CheckLPCost(tp,lp_value) end
            Duel.PayLPCost(tp,lp_value)
          end
        end
        return function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          Duel.PayLPCost(tp,math.floor(Duel.GetLP(tp)*lp_value))
        end
      end
      return function(e,tp,eg,ep,ev,re,r,rp,chk)
        local pay_lp_value=math.floor(Duel.GetLP(tp)-lp_value)
        if chk==0 then return pay_lp_value>0 and Duel.CheckLPCost(tp,pay_lp_value) end
        Duel.PayLPCost(tp,pay_lp_value)
      end
    end
    function Cost.Discard(filter,other,min,max,op)
      local min_type=type(min)
      local max_type=type(max)
      local function filter_final(c,e,tp)
        return (not filter or filter(c,e,tp)) and c:IsDiscardable()
      end
      return function(e,tp,eg,ep,ev,re,r,rp,chk)
        local min_count=(min_type=="function" and min(e,tp)) or (min==nil and 1) or min
        local max_count=(max_type=="function" and max(e,tp)) or (max==nil and min_count) or max
        local exclude=other and e:GetHandler() or nil
        if chk==0 then
          return min_count>0 and max_count>=min_count
            and Duel.IsExistingMatchingCard(filter_final,tp,LOCATION_HAND,0,min_count,exclude,e,tp)
        end
        Duel.DiscardHand(tp,filter_final,min_count,max_count,REASON_COST|REASON_DISCARD,exclude,e,tp)
        if op then op(e,tp,Duel.GetOperatedGroup()) end
      end
    end
    local function use_limit_cost(reset,soft)
      return function(flag,ct)
        ct=ct or 1
        return function(e,tp,eg,ep,ev,re,r,rp,chk)
          local c=e:GetHandler()
          if chk==0 then
            return (soft and c and not c:HasFlagEffect(flag,ct)) or ((not soft) and not Duel.HasFlagEffect(tp,flag,ct))
          end
          if soft and c then
            c:RegisterFlagEffect(flag,RESET_EVENT|RESETS_STANDARD|reset,0,1)
          else
            Duel.RegisterFlagEffect(tp,flag,reset,0,1)
          end
        end
      end
    end
    Cost.SoftUseLimitPerChain=Cost.SoftUseLimitPerChain or use_limit_cost(RESET_CHAIN,true)
    Cost.SoftUseLimitPerBattle=Cost.SoftUseLimitPerBattle or use_limit_cost(RESET_PHASE|PHASE_DAMAGE,true)
    Cost.HardUseLimitPerChain=Cost.HardUseLimitPerChain or use_limit_cost(RESET_CHAIN,false)
    Cost.HardUseLimitPerBattle=Cost.HardUseLimitPerBattle or use_limit_cost(RESET_PHASE|PHASE_DAMAGE,false)
    Cost.SoftOncePerChain=Cost.SoftOncePerChain or Cost.SoftUseLimitPerChain
    Cost.SoftOncePerBattle=Cost.SoftOncePerBattle or Cost.SoftUseLimitPerBattle
    Cost.HardOncePerChain=Cost.HardOncePerChain or Cost.HardUseLimitPerChain
    Cost.HardOncePerBattle=Cost.HardOncePerBattle or Cost.HardUseLimitPerBattle
    function Cost.AND(...)
      local fns={...}
      return function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then
          for _,fn in ipairs(fns) do
            if not fn(e,tp,eg,ep,ev,re,r,rp,0) then return false end
          end
          return true
        end
        for _,fn in ipairs(fns) do
          if fn(e,tp,eg,ep,ev,re,r,rp,1)==false then return false end
        end
      end
    end
    function Cost.Choice(...)
      local choices={...}
      return function(e,tp,eg,ep,ev,re,r,rp,chk)
        local ops={}
        local has_choice=false
        for _,choice in ipairs(choices) do
          local fn,desc,additional_check=table.unpack(choice)
          local check=fn(e,tp,eg,ep,ev,re,r,rp,0) and (not additional_check or additional_check(e,tp,eg,ep,ev,re,r,rp,0))
          table.insert(ops,{check,desc})
          has_choice=has_choice or check
        end
        if chk==0 then return has_choice end
        local op=Duel.SelectEffect(tp,table.unpack(ops))
        if op then
          choices[op][1](e,tp,eg,ep,ev,re,r,rp,1)
          e:SetLabel(op)
        end
      end
    end
    function Cost.Reveal(filter,other,min,max,op,location)
      local min_type=type(min)
      local max_type=type(max)
      location=location or LOCATION_HAND
      local function filter_final(c,e,tp)
        return (not filter or filter(c,e,tp)) and not c:IsPublic()
      end
      return function(e,tp,eg,ep,ev,re,r,rp,chk)
        local min_count=(min_type=="function" and min(e,tp)) or (min==nil and 1) or min
        local max_count=(max_type=="function" and max(e,tp)) or (max==nil and min_count) or max
        local exclude=other and e:GetHandler() or nil
        if chk==0 then
          return min_count>0 and max_count>=min_count
            and Duel.IsExistingMatchingCard(filter_final,tp,location,0,min_count,exclude,e,tp)
        end
        Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_CONFIRM)
        local g=Duel.SelectMatchingCard(tp,filter_final,tp,location,0,min_count,max_count,exclude,e,tp)
        Duel.ConfirmCards(1-tp,g)
        if g:IsExists(Card.IsLocation,1,nil,LOCATION_HAND) then Duel.ShuffleHand(tp) end
        if g:IsExists(Card.IsLocation,1,nil,LOCATION_DECK) then Duel.ShuffleDeck(tp) end
        if g:IsExists(Card.IsLocation,1,nil,LOCATION_EXTRA) then Duel.ShuffleExtra(tp) end
        if op then op(e,tp,g) end
      end
    end
    aux.bfgcost=Cost.SelfBanish
  `;
  const status = lauxlib.luaL_dostring(L, to_luastring(source));
  if (status !== lua.LUA_OK) throw new Error(readLuaError(L));
}
