import fengari from "fengari";
import { duelReason } from "#duel/reasons.js";
import { pushCardTable } from "#lua/card-table-api.js";
import { readCardUid } from "#lua/api-utils.js";
import { luaMoveBlockedByImmunity } from "#lua/duel-api/move-immunity.js";
import { readLuaError } from "#lua/host-script-api.js";
import type { DuelEffectDefinition, DuelSession } from "#duel/types.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";

const { lua, to_luastring } = fengari;

export function installCardEffectCopyApi<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushCopyEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("CopyEffect"));
}

function pushCopyEffect<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
): number {
  if (session.state.status === "ended") {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const receiverUid = readCardUid(L, 1);
  const copiedCode = lua.lua_isnumber(L, 2) ? String(lua.lua_tointeger(L, 2)) : undefined;
  const resetFlags = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : undefined;
  const resetCount = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : undefined;
  const receiver = receiverUid ? session.state.cards.find((card) => card.uid === receiverUid) : undefined;
  if (!receiver || !copiedCode || luaMoveBlockedByImmunity(L, session, hostState, receiver, duelReason.effect) || !ensureCopiedScriptLoaded(L, hostState, copiedCode)) {
    lua.lua_pushinteger(L, 0);
    return 1;
  }

  const copyId = hostState.nextCopyId ?? 1;
  hostState.nextCopyId = copyId + 1;
  const beforeEffectIds = new Set(session.state.effects.map((effect) => effect.id));
  const ok = callInitialEffect(L, receiver.uid, copiedCode);
  if (!ok) {
    lua.lua_pushinteger(L, 0);
    return 1;
  }

  const copied = session.state.effects.filter((effect) => effect.sourceUid === receiver.uid && !beforeEffectIds.has(effect.id));
  for (const effect of copied) markCopiedEffect(hostState, effect, copyId, resetFlags, resetCount);
  lua.lua_pushinteger(L, copied.length > 0 ? copyId : 0);
  return 1;
}

function ensureCopiedScriptLoaded<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, hostState: LuaCardApiState<EffectRecord>, code: string): boolean {
  lua.lua_getglobal(L, to_luastring(`c${code}`));
  const alreadyLoaded = lua.lua_istable(L, -1);
  lua.lua_pop(L, 1);
  if (alreadyLoaded) return true;
  hostState.loadScriptFile?.(`c${code}.lua`);
  lua.lua_getglobal(L, to_luastring(`c${code}`));
  const loaded = lua.lua_istable(L, -1);
  lua.lua_pop(L, 1);
  return loaded;
}

function callInitialEffect(L: unknown, receiverUid: string, copiedCode: string): boolean {
  lua.lua_getglobal(L, to_luastring(`c${copiedCode}`));
  lua.lua_getfield(L, -1, to_luastring("initial_effect"));
  if (!lua.lua_isfunction(L, -1)) {
    lua.lua_pop(L, 2);
    return false;
  }
  lua.lua_getglobal(L, to_luastring("__duel_call_initial_effect"));
  lua.lua_insert(L, -2);
  pushCardTable(L, receiverUid);
  const status = lua.lua_pcall(L, 2, 2, 0);
  if (status !== lua.LUA_OK) {
    readLuaError(L);
    lua.lua_pop(L, 1);
    return false;
  }
  const ok = Boolean(lua.lua_toboolean(L, -2));
  lua.lua_pop(L, 3);
  return ok;
}

function markCopiedEffect<EffectRecord extends LuaCardApiEffectRecord>(
  hostState: LuaCardApiState<EffectRecord>,
  effect: DuelEffectDefinition,
  copyId: number,
  resetFlags: number | undefined,
  resetCount: number | undefined,
): void {
  effect.copyId = copyId;
  if (resetFlags !== undefined) effect.reset = resetCount === undefined ? { flags: resetFlags } : { flags: resetFlags, count: resetCount };
  const luaEffectId = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  const luaEffect = Number.isFinite(luaEffectId) ? hostState.effects.get(luaEffectId) : undefined;
  if (!luaEffect) return;
  luaEffect.copyId = copyId;
  if (resetFlags !== undefined) luaEffect.reset = resetCount === undefined ? { flags: resetFlags } : { flags: resetFlags, count: resetCount };
}
