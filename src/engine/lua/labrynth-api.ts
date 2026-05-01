import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installLabrynthApi(L: unknown): void {
  const source = `
    CARD_LABRYNTH_LABYRINTH=CARD_LABRYNTH_LABYRINTH or 33407125
    SET_WELCOME_LABRYNTH=SET_WELCOME_LABRYNTH or 0x117f
    function aux.WelcomeLabrynthTrapDestroyOperation(e,tp)
      local c=e:GetHandler()
      local addeff=Duel.IsPlayerAffectedByEffect(tp,CARD_LABRYNTH_LABYRINTH)
      local active_trap=(e.GetActiveType and e:GetActiveType()==TYPE_TRAP) or (e.IsActiveType and e:IsActiveType(TYPE_TRAP))
      if not (addeff and addeff:CheckCountLimit(tp)
        and e:IsHasType(EFFECT_TYPE_ACTIVATE) and active_trap
        and c:IsSetCard(SET_WELCOME_LABRYNTH) and not c:IsStatus(STATUS_ACT_FROM_HAND)
        and Duel.IsExistingMatchingCard(nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,c)
        and Duel.SelectYesNo(tp,aux.Stringid(CARD_LABRYNTH_LABYRINTH,1))) then return end
      addeff:UseCountLimit(tp)
      Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_DESTROY)
      local g=Duel.SelectMatchingCard(tp,nil,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,c)
      if g:GetCount()>0 then
        Duel.HintSelection(g,true)
        Duel.BreakEffect()
        Duel.Destroy(g,REASON_EFFECT)
      end
    end
    Auxiliary.WelcomeLabrynthTrapDestroyOperation=aux.WelcomeLabrynthTrapDestroyOperation
  `;
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(source), source.length, to_luastring("labrynth-api.lua"));
  if (status === lua.LUA_OK) lua.lua_pcall(L, 0, 0, 0);
  else lua.lua_pop(L, 1);
}
