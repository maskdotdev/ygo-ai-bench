import fengari from "fengari";
import { changeDuelBattleDamage, getDuelBattleDamage, negateDuelAttack } from "#duel/core.js";
import { pushCardTable } from "#lua/card-api.js";
import type { DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelBattleApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const attackerUid = session.state.currentAttack?.attackerUid;
    if (!attackerUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, attackerUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetAttacker"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const targetUid = session.state.currentAttack?.targetUid;
    if (!targetUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, targetUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetAttackTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = readOptionalPlayer(state, 1) ?? session.state.turnPlayer;
    const monsterUid = battleMonsterUid(session, player);
    if (!monsterUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, monsterUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetBattleMonster"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, negateDuelAttack(session.state));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("NegateAttack"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = readOptionalPlayer(state, 1) ?? session.state.turnPlayer;
    lua.lua_pushinteger(state, getDuelBattleDamage(session.state, player));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetBattleDamage"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = readOptionalPlayer(state, 1) ?? session.state.turnPlayer;
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, changeDuelBattleDamage(session.state, player, value));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ChangeBattleDamage"));
}

function battleMonsterUid(session: DuelSession, player: PlayerId): string | undefined {
  const attack = session.state.currentAttack ?? session.state.pendingBattle;
  if (!attack) return undefined;
  const attacker = session.state.cards.find((card) => card.uid === attack.attackerUid);
  if (attacker?.controller === player && attacker.location === "monsterZone") return attacker.uid;
  const target = attack.targetUid === undefined ? undefined : session.state.cards.find((card) => card.uid === attack.targetUid);
  if (target?.controller === player && target.location === "monsterZone") return target.uid;
  return undefined;
}

function readOptionalPlayer(L: unknown, index: number): PlayerId | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const value = lua.lua_tointeger(L, index);
  if (value !== 0 && value !== 1) return undefined;
  return value;
}
