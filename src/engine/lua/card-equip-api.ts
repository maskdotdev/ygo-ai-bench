import fengari from "fengari";
import { hasZoneSpace, pushDuelLog } from "#duel/card-state.js";
import { collectDuelTriggerEffects, moveDuelCard } from "#duel/core.js";
import { registerDuelFlagEffect } from "#duel/flags.js";
import { duelReason } from "#duel/reasons.js";
import { readCardUid, readTableNumberField, readTableStringField } from "#lua/api-utils.js";
import { matchingLuaEffects } from "#lua/card-effect-query-api.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { markLuaOperationTimingBoundary } from "#lua/duel-api/move.js";
import { pushCardTable } from "#lua/card-table-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";

const { lua, to_luastring } = fengari;

export function installCardEquipApi<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): void {
  pushNumberGetter(L, "GetEquipCount", session, (card) => (card ? equippedCards(session, card.uid).length : 0));
  pushBooleanGetter(L, "HasEquipCard", session, (card) => Boolean(card && equippedCards(session, card.uid).length > 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    pushGroupTable(state, card ? equippedCards(session, card.uid).map((equip) => equip.uid) : []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetEquipGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const equippedToUid = currentEquipTargetUid(card, hostState);
    if (!equippedToUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, equippedToUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetEquipTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    if (!card?.previousEquippedToUid) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardTable(state, card.previousEquippedToUid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetPreviousEquipTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushEquipByEffectAndLimitRegister(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("EquipByEffectAndLimitRegister"));
  lua.lua_pushcfunction(L, (state: unknown) => pushEquipByEffectLimit(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("EquipByEffectLimit"));
}

function pushEquipByEffectAndLimitRegister<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  if (session.state.status === "ended") {
    setOperatedUids(hostState, []);
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const target = readCard(L, session);
  const player = lua.lua_isnumber(L, 3) ? normalizePlayer(lua.lua_tointeger(L, 3)) : target?.controller ?? session.state.turnPlayer;
  const equipUid = readCardUid(L, 4);
  const equip = equipUid ? session.state.cards.find((candidate) => candidate.uid === equipUid) : undefined;
  const code = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : undefined;
  if (!target || !equip || target.location !== "monsterZone" || !hasZoneSpace(session.state, player, "spellTrapZone")) {
    setOperatedUids(hostState, []);
    lua.lua_pushboolean(L, false);
    return 1;
  }
  try {
    markLuaOperationTimingBoundary(session, hostState);
    moveDuelCard(session.state, equip.uid, "spellTrapZone", player, duelReason.effect, player);
    equip.equippedToUid = target.uid;
    delete equip.previousEquippedToUid;
    equip.position = "faceUpAttack";
    equip.faceUp = true;
    if (code !== undefined) registerDuelFlagEffect(session.state, { ownerType: "card", ownerId: equip.uid }, code, 0x1fe0000, 0, 0);
    pushDuelLog(session.state, "equip", player, equip.name, `Equipped to ${target.name}`);
    collectDuelTriggerEffects(session.state, "equipped", equip, luaEffectReasonPayload(hostState, duelReason.effect, hostState.activeContext?.player ?? player));
    if (hostState.activeContext) hostState.activeOperationMoved = true;
    setOperatedUids(hostState, [equip.uid]);
    lua.lua_pushboolean(L, true);
    return 1;
  } catch {
    setOperatedUids(hostState, []);
    lua.lua_pushboolean(L, false);
    return 1;
  }
}

function pushEquipByEffectLimit<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const effectId = readTableNumberField(L, 1, "__effect_id");
  const cardUid = readCardUid(L, 2);
  const effect = effectId === undefined ? undefined : hostState.effects.get(effectId);
  const card = cardUid ? session.state.cards.find((candidate) => candidate.uid === cardUid) : undefined;
  if (!effect || !card || effect.sourceUid !== cardUid) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const matches = effect.labelObjectId !== undefined && matchingLuaEffects(session.state, card, 89785855, hostState).some((candidate) => candidate.id === effect.labelObjectId);
  lua.lua_pushboolean(L, matches);
  return 1;
}

function equippedCards(session: DuelSession, uid: string): DuelCardInstance[] {
  return session.state.cards.filter((card) => card.equippedToUid === uid && card.location === "spellTrapZone");
}

function currentEquipTargetUid<EffectRecord extends LuaCardApiEffectRecord>(card: DuelCardInstance | undefined, hostState: LuaCardApiState<EffectRecord>): string | undefined {
  if (!card) return undefined;
  if (card.equippedToUid !== undefined) return card.equippedToUid;
  const eventCard = hostState.activeContext?.eventCard;
  return hostState.activeContext?.eventName === "leftField" && eventCard?.uid === card.uid && card.previousLocation === "spellTrapZone" ? card.previousEquippedToUid : undefined;
}

function pushNumberGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => number): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readTableStringField(L, 1, "__duel_uid");
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function setOperatedUids<EffectRecord extends LuaCardApiEffectRecord>(hostState: LuaCardApiState<EffectRecord>, uids: string[]): void {
  hostState.operatedUids?.splice(0, hostState.operatedUids.length, ...uids);
}
