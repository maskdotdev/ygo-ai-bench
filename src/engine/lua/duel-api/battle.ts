import fengari from "fengari";
import { calculateDuelBattle, changeDuelBattleDamage, damageDuelPlayer, getDuelAttackableTargets, getDuelAttackCostPaid, getDuelBattleDamage, negateDuelAttack, setDuelAttackCostPaid } from "#duel/core.js";
import { recordBattledPair } from "#duel/battle.js";
import { clearBattleWindowState, openBattleWindowState } from "#duel/battle-window-state.js";
import { readCardUid } from "#lua/api-utils.js";
import { pushCardTable } from "#lua/card-api.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { pushGroupTable } from "#lua/group-api.js";
import type { DuelCardInstance, DuelEffectContext, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelBattleApiHostState {
  activeContext?: DuelEffectContext | undefined;
}

export function installDuelBattleApi(L: unknown, session: DuelSession, hostState: LuaDuelBattleApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const attackerUid = currentBattle(session)?.attackerUid ?? activeBattlePair(session, hostState)?.attackerUid;
    if (!attackerUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, attackerUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetAttacker"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const targetUid = currentBattle(session)?.targetUid ?? activeBattlePair(session, hostState)?.targetUid;
    if (!targetUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, targetUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetAttackTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    pushGroupTable(state, session.state.attackedTargetUids.filter((uid) => session.state.cards.some((card) => card.uid === uid)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetAttackedGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = readOptionalPlayer(state, 1) ?? session.state.turnPlayer;
    const [playerMonsterUid, opponentMonsterUid] = battleMonsterUids(session, player);
    if (playerMonsterUid) pushCardTable(state, playerMonsterUid);
    else lua.lua_pushnil(state);
    if (opponentMonsterUid) pushCardTable(state, opponentMonsterUid);
    else lua.lua_pushnil(state);
    return 2;
  });
  lua.lua_setfield(L, -2, to_luastring("GetBattleMonster"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, changeAttackTarget(session, readCardUid(state, 1)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ChangeAttackTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, changeAttacker(session, readCardUid(state, 1)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ChangeAttacker"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, chainAttack(session, readCardUid(state, 1), hostState));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ChainAttack"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, forceAttack(session, readCardUid(state, 1), readCardUid(state, 2)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ForceAttack"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      lua.lua_pushboolean(state, false);
      return 1;
    }
    const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
    const payload = luaEffectReasonPayload(hostState, 0x40, reasonPlayer);
    lua.lua_pushboolean(state, negateDuelAttack(session.state, reasonPlayer, payload));
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
    if (session.state.status === "ended") {
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const player = readOptionalPlayer(state, 1) ?? session.state.turnPlayer;
    const value = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0;
    lua.lua_pushinteger(state, changeDuelBattleDamage(session.state, player, value));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ChangeBattleDamage"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCalculateDamage(state, session));
  lua.lua_setfield(L, -2, to_luastring("CalculateDamage"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const status = lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : 1;
    setDuelAttackCostPaid(session.state, status);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("AttackCostPaid"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, getDuelAttackCostPaid(session.state));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsAttackCostPaid"));
}

function currentBattle(session: DuelSession): DuelSession["state"]["currentAttack"] {
  return session.state.currentAttack ?? session.state.pendingBattle;
}

function activeBattlePair(session: DuelSession, hostState: LuaDuelBattleApiHostState): { attackerUid: string; targetUid?: string } | undefined {
  const eventName = hostState.activeContext?.eventName;
  if (eventName !== "afterDamageCalculation" && eventName !== "battleDestroyed" && eventName !== "battleEnded" && eventName !== "damageStepEnded") return undefined;
  return session.state.battlePairs.at(-1);
}

function pushCalculateDamage(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const attacker = readBattleCard(L, session, 1);
  const defender = readBattleCard(L, session, 2);
  if (!attacker || attacker.location !== "monsterZone") {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const attackerAttackOverride = readOptionalStat(L, 3);
  const defenderStatOverride = readOptionalStat(L, 4);
  if (attackerAttackOverride === undefined && defenderStatOverride === undefined) {
    lua.lua_pushinteger(L, calculateDuelBattle(session.state, attacker.uid, defender?.uid));
    return 1;
  }
  const result = calculateBattleDamage(attacker, defender, attackerAttackOverride, defenderStatOverride);
  if (result.damage > 0) {
    changeDuelBattleDamage(session.state, result.player, result.damage);
    damageDuelPlayer(session.state, result.player, result.damage);
  }
  lua.lua_pushinteger(L, result.damage);
  return 1;
}

function changeAttackTarget(session: DuelSession, targetUid: string | undefined): boolean {
  if (session.state.status === "ended") return false;
  const attack = session.state.currentAttack;
  const pending = session.state.pendingBattle;
  if (!attack || !pending) return false;
  const attacker = session.state.cards.find((card) => card.uid === attack.attackerUid);
  if (!attacker) return false;
  if (targetUid === undefined) {
    delete attack.targetUid;
    delete pending.targetUid;
    refreshForcedAttackTargetReplayState(session, attacker.uid);
    return true;
  }
  const target = session.state.cards.find((card) => card.uid === targetUid);
  if (!target || target.location !== "monsterZone" || target.controller === attacker.controller || target.uid === attacker.uid) return false;
  attack.targetUid = target.uid;
  pending.targetUid = target.uid;
  recordBattledPair(session.state, attacker.uid, target.uid);
  refreshForcedAttackTargetReplayState(session, attacker.uid);
  return true;
}

function refreshForcedAttackTargetReplayState(session: DuelSession, attackerUid: string): void {
  const replayTargetUids = getDuelAttackableTargets(session.state, attackerUid)
    .targets.map((target) => target.uid)
    .sort();
  const replayTargetCount = replayTargetUids.length;
  if (session.state.currentAttack?.attackerUid === attackerUid) {
    session.state.currentAttack.replayTargetCount = replayTargetCount;
    session.state.currentAttack.replayTargetUids = [...replayTargetUids];
  }
  if (session.state.pendingBattle?.attackerUid === attackerUid) {
    session.state.pendingBattle.replayTargetCount = replayTargetCount;
    session.state.pendingBattle.replayTargetUids = [...replayTargetUids];
  }
}

function changeAttacker(session: DuelSession, attackerUid: string | undefined): boolean {
  if (session.state.status === "ended") return false;
  const attack = session.state.currentAttack;
  const pending = session.state.pendingBattle;
  if (!attack || !pending || !attackerUid) return false;
  const previousAttacker = session.state.cards.find((card) => card.uid === attack.attackerUid);
  const replacement = session.state.cards.find((card) => card.uid === attackerUid);
  const target = attack.targetUid === undefined ? undefined : session.state.cards.find((card) => card.uid === attack.targetUid);
  if (!previousAttacker || !replacement || replacement.location !== "monsterZone") return false;
  if (replacement.controller !== previousAttacker.controller || replacement.uid === target?.uid) return false;
  attack.attackerUid = replacement.uid;
  pending.attackerUid = replacement.uid;
  session.state.attacksDeclared = session.state.attacksDeclared.filter((uid) => uid !== previousAttacker.uid && uid !== replacement.uid);
  session.state.attacksDeclared.push(replacement.uid);
  return true;
}

function chainAttack(session: DuelSession, targetUid: string | undefined, hostState: LuaDuelBattleApiHostState): boolean {
  if (session.state.status === "ended") return false;
  const attack = session.state.currentAttack ?? session.state.pendingBattle;
  if (!attack) return chainAttackFromActiveContext(session, targetUid, hostState);
  const attacker = session.state.cards.find((card) => card.uid === attack.attackerUid);
  if (!attacker || attacker.location !== "monsterZone") return false;
  const target = targetUid === undefined ? undefined : session.state.cards.find((card) => card.uid === targetUid);
  if (targetUid !== undefined && (!target || target.location !== "monsterZone" || target.controller === attacker.controller || target.uid === attacker.uid)) return false;
  session.state.attacksDeclared = session.state.attacksDeclared.filter((uid) => uid !== attacker.uid);
  session.state.attackPasses = [];
  session.state.damagePasses = [];
  if (targetUid === undefined) {
    delete session.state.currentAttack;
    delete session.state.pendingBattle;
    clearBattleWindowState(session.state);
    session.state.waitingFor = attacker.controller;
    return true;
  }
  if (!target) return false;
  session.state.currentAttack = { attackerUid: attacker.uid, targetUid: target.uid };
  session.state.pendingBattle = { ...session.state.currentAttack };
  recordBattledPair(session.state, attacker.uid, target.uid);
  openBattleWindowState(session.state, "attackTargetConfirmation", "attack", target.controller);
  session.state.waitingFor = target.controller;
  return true;
}

function chainAttackFromActiveContext(session: DuelSession, targetUid: string | undefined, hostState: LuaDuelBattleApiHostState): boolean {
  const attacker = hostState.activeContext?.source;
  if (!attacker || attacker.location !== "monsterZone" || !session.state.attacksDeclared.includes(attacker.uid)) return false;
  const target = targetUid === undefined ? undefined : session.state.cards.find((card) => card.uid === targetUid);
  if (targetUid !== undefined && (!target || target.location !== "monsterZone" || target.controller === attacker.controller || target.uid === attacker.uid)) return false;
  session.state.attacksDeclared = session.state.attacksDeclared.filter((uid) => uid !== attacker.uid);
  session.state.attackPasses = [];
  session.state.damagePasses = [];
  if (targetUid === undefined) {
    delete session.state.currentAttack;
    delete session.state.pendingBattle;
    clearBattleWindowState(session.state);
    session.state.waitingFor = attacker.controller;
    return true;
  }
  if (!target) return false;
  session.state.currentAttack = { attackerUid: attacker.uid, targetUid: target.uid };
  session.state.pendingBattle = { ...session.state.currentAttack };
  recordBattledPair(session.state, attacker.uid, target.uid);
  openBattleWindowState(session.state, "attackTargetConfirmation", "attack", target.controller);
  session.state.waitingFor = target.controller;
  return true;
}

function forceAttack(session: DuelSession, attackerUid: string | undefined, targetUid: string | undefined): boolean {
  if (session.state.status === "ended") return false;
  if (!attackerUid || !targetUid) return false;
  const attacker = session.state.cards.find((card) => card.uid === attackerUid);
  const target = session.state.cards.find((card) => card.uid === targetUid);
  if (!attacker || !target || attacker.location !== "monsterZone" || target.location !== "monsterZone") return false;
  if (attacker.controller === target.controller || attacker.uid === target.uid) return false;
  session.state.currentAttack = { attackerUid: attacker.uid, targetUid: target.uid };
  session.state.pendingBattle = { ...session.state.currentAttack };
  recordBattledPair(session.state, attacker.uid, target.uid);
  openBattleWindowState(session.state, "attackTargetConfirmation", "attack", target.controller);
  session.state.attackPasses = [];
  session.state.damagePasses = [];
  session.state.attacksDeclared = session.state.attacksDeclared.filter((uid) => uid !== attacker.uid);
  session.state.attacksDeclared.push(attacker.uid);
  session.state.waitingFor = target.controller;
  return true;
}

function battleMonsterUids(session: DuelSession, player: PlayerId): [string | undefined, string | undefined] {
  const attack = session.state.currentAttack ?? session.state.pendingBattle;
  if (!attack) return [undefined, undefined];
  const attacker = session.state.cards.find((card) => card.uid === attack.attackerUid);
  const target = attack.targetUid === undefined ? undefined : session.state.cards.find((card) => card.uid === attack.targetUid);
  const attackerUid = attacker?.location === "monsterZone" ? attacker.uid : undefined;
  const targetUid = target?.location === "monsterZone" ? target.uid : undefined;
  if (attacker?.controller === player) return [attackerUid, targetUid];
  if (target?.controller === player) return [targetUid, attackerUid];
  return [undefined, undefined];
}

function readBattleCard(L: unknown, session: DuelSession, index: number): DuelCardInstance | undefined {
  const uid = readCardUid(L, index);
  return uid ? session.state.cards.find((card) => card.uid === uid) : undefined;
}

function readOptionalStat(L: unknown, index: number): number | undefined {
  return lua.lua_isnumber(L, index) ? Math.max(0, lua.lua_tointeger(L, index)) : undefined;
}

function calculateBattleDamage(
  attacker: DuelCardInstance,
  defender: DuelCardInstance | undefined,
  attackerAttackOverride: number | undefined,
  defenderStatOverride: number | undefined,
): { player: PlayerId; damage: number } {
  const attackerAttack = attackerAttackOverride ?? battleAttack(attacker);
  if (!defender || (defender.location !== "monsterZone" && defenderStatOverride === undefined)) return { player: otherPlayer(attacker.controller), damage: attackerAttack };
  const defenderStat = defenderStatOverride ?? (defender.position === "faceUpAttack" ? battleAttack(defender) : battleDefense(defender));
  if (defender.position === "faceUpAttack") {
    if (attackerAttack > defenderStat) return { player: defender.controller, damage: attackerAttack - defenderStat };
    if (attackerAttack < defenderStat) return { player: attacker.controller, damage: defenderStat - attackerAttack };
    return { player: defender.controller, damage: 0 };
  }
  if (attackerAttack < defenderStat) return { player: attacker.controller, damage: defenderStat - attackerAttack };
  return { player: defender.controller, damage: 0 };
}

function battleAttack(card: DuelCardInstance): number {
  return Math.max(0, (card.data.attack ?? 0) + (card.attackModifier ?? 0));
}

function battleDefense(card: DuelCardInstance): number {
  return Math.max(0, (card.data.defense ?? 0) + (card.defenseModifier ?? 0));
}

function readOptionalPlayer(L: unknown, index: number): PlayerId | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const value = lua.lua_tointeger(L, index);
  if (value !== 0 && value !== 1) return undefined;
  return value;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
