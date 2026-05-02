import fengari from "fengari";

const { lua, lauxlib, to_luastring } = fengari;

export function installGroupCompatibilityApi(L: unknown): void {
  const source = `
    Group.NewGroup=Group.CreateGroup
    function Group.Iter(g)
      local first=true
      return function()
        if first then
          first=false
          return g:GetFirst()
        end
        return g:GetNext()
      end
    end
    function Group.GetToBeLinkedZone(g,c,tp,clink,emz)
      local zone=0
      for tc in Group.Iter(g) do
        zone=zone|tc:GetToBeLinkedZone(c,tp,clink,emz)
      end
      return zone
    end
    function Group.AddMaximumCheck(g)
      local result=g:Clone()
      for tc in Group.Iter(g) do
        if tc:IsMaximumMode() then
          result:Merge(Duel.GetMatchingGroup(Card.IsMaximumMode,tc:GetControler(),LOCATION_MZONE,0,tc))
        end
      end
      return result
    end
  `;
  const status = lauxlib.luaL_loadbuffer(L, to_luastring(source), source.length, to_luastring("group-compat.lua"));
  if (status === lua.LUA_OK) lua.lua_pcall(L, 0, 0, 0);
  else lua.lua_pop(L, 1);
}
