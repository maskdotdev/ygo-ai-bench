import fengari from "fengari";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { duelReason } from "#duel/reasons.js";
import { readCardUid, readTableStringField } from "#lua/api-utils.js";
import { readRequestedNumbers } from "#lua/card-code-utils.js";
import { createLuaMaterialCheckContext, matchingLuaEffects } from "#lua/card-effect-query-api.js";
import { isMonsterLike } from "#lua/card-eligibility-api.js";
import { pushCardTable } from "#lua/card-table-api.js";
import { cardLink, cardRank } from "#lua/card-stat-api.js";
import type { DuelCardInstance, DuelSession, DuelState } from "#duel/types.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";

const { lua, to_luastring } = fengari;

export function installCardStatusApi<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushRitualLevel(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetRitualLevel"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSynchroLevel(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetSynchroLevel"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    const status = card ? cardStatusMask(session.state, card) : 0;
    lua.lua_pushboolean(state, Boolean(card && requested.some((value) => (status & value) !== 0)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsStatus"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSetStatus(state, session));
  lua.lua_setfield(L, -2, to_luastring("SetStatus"));
}

function pushSetStatus(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const card = readCard(L, session);
  const mask = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  if (!card || mask === 0) return 0;
  const current = card.customStatusMask ?? 0;
  card.customStatusMask = lua.lua_isnoneornil(L, 3) || lua.lua_toboolean(L, 3) ? current | mask : current & ~mask;
  return 0;
}

function pushRitualLevel<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  if (!card) {
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const ritualTargetUid = readCardUid(L, 2);
  const ritualTarget = ritualTargetUid ? session.state.cards.find((candidate) => candidate.uid === ritualTargetUid) : undefined;
  const effect = matchingLuaEffects(session.state, card, 241, hostState)[0];
  lua.lua_pushinteger(L, effect ? ritualLevelFromEffect(L, effect, card, ritualTarget, hostState) : card.data.level ?? 0);
  return 1;
}

function pushSynchroLevel<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  if (!card) return lua.lua_pushinteger(L, 0), 1;
  const syncTargetUid = readCardUid(L, 2);
  const syncTarget = syncTargetUid ? session.state.cards.find((candidate) => candidate.uid === syncTargetUid) : undefined;
  const effect = matchingLuaEffects(session.state, card, 240, hostState)[0];
  lua.lua_pushinteger(L, effect ? synchroLevelFromEffect(L, effect, syncTarget, hostState) : card.data.level ?? 0);
  return 1;
}

function ritualLevelFromEffect<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  effect: EffectRecord,
  card: DuelCardInstance,
  ritualTarget: DuelCardInstance | undefined,
  hostState: LuaCardApiState<EffectRecord>,
): number {
  if (effect.valueRef !== undefined) {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, effect.valueRef);
    hostState.pushEffectTable(L, effect.id);
    pushCardTable(L, card.uid);
    if (ritualTarget) pushCardTable(L, ritualTarget.uid);
    else lua.lua_pushnil(L);
    const status = lua.lua_pcall(L, 3, 1, 0);
    if (status === lua.LUA_OK) {
      const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : card.data.level ?? 0;
      lua.lua_pop(L, 1);
      return value;
    }
    lua.lua_pop(L, 1);
  }
  return effect.value ?? card.data.level ?? 0;
}

function synchroLevelFromEffect<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, effect: EffectRecord, syncTarget: DuelCardInstance | undefined, hostState: LuaCardApiState<EffectRecord>): number {
  if (effect.valueRef === undefined) return effect.value ?? 0;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, effect.valueRef);
  hostState.pushEffectTable(L, effect.id);
  syncTarget ? pushCardTable(L, syncTarget.uid) : lua.lua_pushnil(L);
  const status = lua.lua_pcall(L, 2, 1, 0);
  if (status !== lua.LUA_OK) return lua.lua_pop(L, 1), 0;
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : 0;
  lua.lua_pop(L, 1);
  return value;
}

function cardStatusMask(state: DuelState, card: DuelCardInstance): number {
  let mask = card.customStatusMask ?? 0;
  if (isCardDisabled(state, card, createLuaMaterialCheckContext(state))) mask |= 0x1;
  if (card.faceUp && (card.location === "monsterZone" || card.location === "spellTrapZone")) mask |= 0x400;
  if ((card.data.level ?? 0) <= 0 && cardRank(card) === 0 && cardLink(card) === 0 && isMonsterLike(card)) mask |= 0x20;
  if (card.summonType === "normal" || card.summonType === "tribute") mask |= 0x800;
  if (card.summonType === "flip") mask |= 0x20000000;
  if (card.summonType && card.summonType !== "normal" && card.summonType !== "tribute" && card.summonType !== "flip") mask |= 0x40000000;
  if ((card.reason ?? 0) & duelReason.battle) mask |= 0x4000;
  if (state.attackCanceledUids.includes(card.uid)) mask |= 0x200000;
  if (isOpposingMonsterBattle(state, card.uid)) mask |= 0x10000000;
  if (state.chain.some((link) => link.sourceUid === card.uid)) mask |= 0x10000;
  return mask;
}

function isOpposingMonsterBattle(state: DuelState, uid: string): boolean {
  const battle = state.currentAttack ?? state.pendingBattle;
  return Boolean(battle?.targetUid && (battle.attackerUid === uid || battle.targetUid === uid));
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1) ?? readTableStringField(L, 1, "__duel_uid");
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}
