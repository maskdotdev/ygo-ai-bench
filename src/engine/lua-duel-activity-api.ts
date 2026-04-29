import fengari from "fengari";
import type { DuelSession, PlayerId } from "./duel-types.js";

const { lua, to_luastring } = fengari;

const activity = {
  summon: 0x1,
  normalSummon: 0x2,
  specialSummon: 0x4,
  flipSummon: 0x8,
  attack: 0x10,
} as const;

export function installDuelActivityApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const kind = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : activity.summon;
    lua.lua_pushinteger(state, getActivityCount(session, player, kind));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetActivityCount"));
}

function getActivityCount(session: DuelSession, player: PlayerId, kind: number): number {
  if (kind === activity.attack) return attackActivityCount(session, player);
  if (kind === activity.specialSummon || kind === activity.flipSummon) return 0;
  if (kind === activity.summon || kind === activity.normalSummon) return normalSummonActivityCount(session, player);
  return 0;
}

function normalSummonActivityCount(session: DuelSession, player: PlayerId): number {
  if (session.state.turnPlayer !== player) return 0;
  return session.state.players[player].normalSummonAvailable ? 0 : 1;
}

function attackActivityCount(session: DuelSession, player: PlayerId): number {
  return session.state.attacksDeclared.filter((uid) => session.state.cards.find((card) => card.uid === uid)?.controller === player).length;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
