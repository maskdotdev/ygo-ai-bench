import fengari from "fengari";
import { resetDuelCardEffects } from "#duel/effect-reset.js";
import { readCardUid } from "#lua/api-utils.js";
import type { DuelEffectDefinition, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

const resetEvent = 0x1000;
const resetCode = 0x4000;
const resetCopy = 0x8000;

export function installCardEffectResetApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushResetEffect(state, session));
  lua.lua_setfield(L, -2, to_luastring("ResetEffect"));
}

function pushResetEffect(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const uid = readCardUid(L, 1);
  const resetValue = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const resetType = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : undefined;
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  if (!card || resetValue === undefined || resetType === undefined) return 0;
  resetDuelCardEffects(session.state, card, (effect) => matchesCardResetEffect(effect, resetValue, resetType));
  return 0;
}

function matchesCardResetEffect(effect: DuelEffectDefinition, resetValue: number, resetType: number): boolean {
  if (resetType === resetEvent) return ((effect.reset?.flags ?? 0) & resetValue) !== 0;
  if (resetType === resetCode) return effect.code === resetValue;
  if (resetType === resetCopy) return effect.copyId === resetValue;
  return false;
}
