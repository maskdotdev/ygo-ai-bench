import fengari from "fengari";
import { applyResponse, getLegalActions } from "#duel/core.js";
import { readCardUid, readTableNumberField } from "#lua/api-utils.js";
import type { DuelEffectContext, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelEffectApiHostState {
  activeLuaEffectId?: number | undefined;
  activeContext?: DuelEffectContext | undefined;
  pushEffectTable: (state: unknown, id: number) => void;
  registerEffect: (state: unknown, id: number, player: PlayerId) => boolean;
  majesticCopy: (state: unknown, receiverUid: string, sourceUid: string, reset?: number) => number;
}

export function installDuelEffectApi(L: unknown, session: DuelSession, hostState: LuaDuelEffectApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      lua.lua_pushboolean(state, false);
      return 1;
    }
    const effectId = readTableNumberField(state, 1, "__effect_id");
    const player = normalizePlayer(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0);
    lua.lua_pushboolean(state, effectId !== undefined && hostState.registerEffect(state, effectId, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushActivateResult(state, session));
  lua.lua_setfield(L, -2, to_luastring("Activate"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, getReasonPlayer(session, hostState));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetReasonPlayer"));
  lua.lua_pushcfunction(L, (state: unknown) => pushReasonEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetReasonEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const receiverUid = readCardUid(state, 1);
    const sourceUid = readCardUid(state, 2);
    const reset = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : undefined;
    lua.lua_pushinteger(state, receiverUid && sourceUid ? hostState.majesticCopy(state, receiverUid, sourceUid, reset) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("MajesticCopy"));
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function pushActivateResult(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const effectId = readTableNumberField(L, 1, "__effect_id");
  const duelEffectId = effectId === undefined ? undefined : `lua-${effectId}`;
  const effect = session.state.effects.find((candidate) => candidate.id === duelEffectId);
  if (!effect) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const action = getLegalActions(session, effect.controller).find((candidate) => candidate.type === "activateEffect" && candidate.uid === effect.sourceUid && candidate.effectId === effect.id);
  const result = action ? applyResponse(session, action) : { ok: false };
  lua.lua_pushboolean(L, result.ok);
  return 1;
}

function getReasonPlayer(session: DuelSession, hostState: LuaDuelEffectApiHostState): PlayerId {
  return hostState.activeContext?.eventReasonPlayer ?? hostState.activeContext?.eventCard?.reasonPlayer ?? hostState.activeContext?.eventCard?.controller ?? hostState.activeContext?.player ?? session.state.turnPlayer;
}

function pushReasonEffect(L: unknown, session: DuelSession, hostState: LuaDuelEffectApiHostState): number {
  const activeChainEffectId = hostState.activeContext?.chainLink?.effectId;
  const activeChainLuaId = Number(activeChainEffectId?.match(/^lua-(\d+)/)?.[1]);
  const eventReasonPlayer = hostState.activeContext?.chainLink?.eventReasonPlayer ?? hostState.activeContext?.eventReasonPlayer;
  if (Number.isFinite(activeChainLuaId) && eventReasonPlayer !== undefined && hostState.activeContext?.chainLink?.player !== eventReasonPlayer) {
    hostState.pushEffectTable(L, activeChainLuaId);
    return 1;
  }
  if (hostState.activeContext?.eventReasonEffectId !== undefined) {
    hostState.pushEffectTable(L, restoredReasonEffectLuaId(session, hostState.activeContext) ?? hostState.activeContext.eventReasonEffectId);
    return 1;
  }
  if (Number.isFinite(activeChainLuaId)) {
    hostState.pushEffectTable(L, activeChainLuaId);
    return 1;
  }
  const effectId = (hostState.activeContext?.chainLink ?? session.state.chain[session.state.chain.length - 1])?.effectId;
  const id = Number(effectId?.match(/^lua-(\d+)/)?.[1]);
  if (Number.isFinite(id)) hostState.pushEffectTable(L, id);
  else lua.lua_pushnil(L);
  return 1;
}

function restoredReasonEffectLuaId(session: DuelSession, ctx: DuelEffectContext): number | undefined {
  const reasonEffectId = ctx.eventReasonEffectId;
  const reasonCardUid = ctx.eventReasonCardUid;
  if (reasonEffectId === undefined || reasonCardUid === undefined) return undefined;
  const originalIdPattern = new RegExp(`:lua-${reasonEffectId}(?:-|$)`);
  const effect = session.state.effects.find((candidate) =>
    candidate.sourceUid === reasonCardUid && (
      Number(candidate.id.match(/^lua-(\d+)/)?.[1]) === reasonEffectId ||
      originalIdPattern.test(candidate.registryKey ?? "")
    )
  );
  const restoredId = Number(effect?.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(restoredId) ? restoredId : undefined;
}
