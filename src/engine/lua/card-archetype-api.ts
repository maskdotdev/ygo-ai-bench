import fengari from "fengari";
import { isCardForbidden } from "#duel/continuous-effects.js";
import { readCardUid } from "#lua/api-utils.js";
import { matchingLuaEffects } from "#lua/card-effect-query-api.js";
import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";
import type { DuelCardInstance, DuelSession, DuelState, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardArchetypeApi<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
): void {
  pushBooleanGetter(L, "IsDrone", session, (card) => Boolean(card?.data.setcodes?.includes(0x581)));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsRikkaReleasable(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsRikkaReleasable"));
  pushBooleanGetter(L, "IsForbidden", session, (card) => Boolean(card && isCardForbidden(session.state, card, createLuaMaterialCheckContext(session.state))));
}

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushIsRikkaReleasable<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const player = normalizePlayer(lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : session.state.turnPlayer);
  lua.lua_pushboolean(L, Boolean(card && isRikkaReleasable(session.state, card, player, hostState)));
  return 1;
}

function isRikkaReleasable<EffectRecord extends LuaCardApiEffectRecord>(state: DuelState, card: DuelCardInstance, player: PlayerId, hostState: LuaCardApiState<EffectRecord>): boolean {
  if (((card.data.race ?? 0) & 0x400) !== 0) return true;
  return card.controller === otherPlayer(player) && matchingLuaEffects(state, card, 76869711, hostState).length > 0;
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
