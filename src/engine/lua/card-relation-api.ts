import fengari from "fengari";
import { readTableNumberField, readTableStringField } from "#lua/api-utils.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api.js";
import { pushCardTable } from "#lua/card-table-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardRelationApi<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushCreateEffectRelation(state, session));
  lua.lua_setfield(L, -2, to_luastring("CreateEffectRelation"));
  lua.lua_pushcfunction(L, (state: unknown) => pushReleaseEffectRelation(state, session));
  lua.lua_setfield(L, -2, to_luastring("ReleaseEffectRelation"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSetCardTarget(state, session));
  lua.lua_setfield(L, -2, to_luastring("SetCardTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCancelCardTarget(state, session));
  lua.lua_setfield(L, -2, to_luastring("CancelCardTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetCardTarget(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetCardTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetFirstCardTarget(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetFirstCardTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetCardTargetCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetCardTargetCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetOwnerTarget(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetOwnerTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetFirstOwnerTarget(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetFirstOwnerTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetOwnerTargetCount(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetOwnerTargetCount"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsHasCardTarget(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsHasCardTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCreateRelation(state, session));
  lua.lua_setfield(L, -2, to_luastring("CreateRelation"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetMarkedEffects(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetMarkedEffects"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsRelateToEffect(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsRelateToEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsRelateToChain(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsRelateToChain"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsRelateToCard(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsRelateToCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsRelateToBattle(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsRelateToBattle"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCancelToGrave(state, session));
  lua.lua_setfield(L, -2, to_luastring("CancelToGrave"));
}

function pushCreateEffectRelation(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const card = readCard(L, session);
  const effectId = readTableNumberField(L, 2, "__effect_id");
  if (card && effectId !== undefined) {
    card.effectRelationIds = card.effectRelationIds ?? [];
    if (!card.effectRelationIds.includes(effectId)) card.effectRelationIds.push(effectId);
  }
  return 0;
}

function pushReleaseEffectRelation(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const card = readCard(L, session);
  const effectId = readTableNumberField(L, 2, "__effect_id");
  if (card && effectId !== undefined) card.effectRelationIds = (card.effectRelationIds ?? []).filter((id) => id !== effectId);
  return 0;
}

function pushSetCardTarget(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const card = readCard(L, session, 1);
  const target = readCard(L, session, 2);
  setCardTarget(card, target);
  return 0;
}

function pushCancelCardTarget(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const card = readCard(L, session, 1);
  const target = readCard(L, session, 2);
  if (card && target) card.cardTargetUids = (card.cardTargetUids ?? []).filter((uid) => uid !== target.uid);
  return 0;
}

function pushGetCardTarget(L: unknown, session: DuelSession): number {
  const card = readCard(L, session, 1);
  pushGroupTable(L, card?.cardTargetUids ?? []);
  return 1;
}

function pushGetFirstCardTarget(L: unknown, session: DuelSession): number {
  const card = readCard(L, session, 1);
  const uid = card?.cardTargetUids?.[0];
  if (!uid) {
    lua.lua_pushnil(L);
    return 1;
  }
  pushCardTable(L, uid);
  return 1;
}

function pushGetCardTargetCount(L: unknown, session: DuelSession): number {
  const card = readCard(L, session, 1);
  lua.lua_pushinteger(L, card?.cardTargetUids?.length ?? 0);
  return 1;
}

function pushGetOwnerTarget(L: unknown, session: DuelSession): number {
  const card = readCard(L, session, 1);
  pushGroupTable(L, ownerTargetUids(session, card));
  return 1;
}

function pushGetFirstOwnerTarget(L: unknown, session: DuelSession): number {
  const uid = ownerTargetUids(session, readCard(L, session, 1))[0];
  if (!uid) {
    lua.lua_pushnil(L);
    return 1;
  }
  pushCardTable(L, uid);
  return 1;
}

function pushGetOwnerTargetCount(L: unknown, session: DuelSession): number {
  lua.lua_pushinteger(L, ownerTargetUids(session, readCard(L, session, 1)).length);
  return 1;
}

function pushIsHasCardTarget(L: unknown, session: DuelSession): number {
  const card = readCard(L, session, 1);
  const target = readCard(L, session, 2);
  lua.lua_pushboolean(L, Boolean(card && target && card.cardTargetUids?.includes(target.uid)));
  return 1;
}

function pushCreateRelation(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const card = readCard(L, session, 1);
  const target = readCard(L, session, 2);
  setCardTarget(card, target);
  return 0;
}

function pushGetMarkedEffects<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const code = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  lua.lua_newtable(L);
  if (!card || code === undefined) return 1;
  let index = 1;
  for (const effect of hostState.effects.values()) {
    if (effect.sourceUid !== card.uid || effect.code !== code || ((effect.typeFlags ?? 0) & 0x1) === 0 || effect.labelObjectId === undefined) continue;
    hostState.pushEffectTable(L, effect.labelObjectId);
    lua.lua_rawseti(L, -2, index);
    index += 1;
  }
  return 1;
}

function pushIsRelateToEffect(L: unknown, session: DuelSession): number {
  const card = readCard(L, session, 1);
  const effectId = readTableNumberField(L, 2, "__effect_id");
  if (card?.effectRelationIds !== undefined && effectId !== undefined) {
    lua.lua_pushboolean(L, card.effectRelationIds.includes(effectId));
    return 1;
  }
  lua.lua_pushboolean(L, Boolean(card));
  return 1;
}

function pushIsRelateToChain<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
): number {
  const card = readCard(L, session, 1);
  const requestedIndex = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const link = chainLinkByLuaIndex(session, requestedIndex, hostState);
  lua.lua_pushboolean(L, Boolean(card && link && card.uid === link.sourceUid && isCardRelatedToChainLink(card, link)));
  return 1;
}

function pushIsRelateToCard(L: unknown, session: DuelSession): number {
  const source = readCard(L, session, 1);
  const target = readCard(L, session, 2);
  lua.lua_pushboolean(L, Boolean(source && target && (source.cardTargetUids?.includes(target.uid) || (isOnField(source) && isOnField(target)))));
  return 1;
}

function pushIsRelateToBattle(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  lua.lua_pushboolean(L, Boolean(card && isRelatedToBattle(session, card.uid)));
  return 1;
}

function pushCancelToGrave(L: unknown, session: DuelSession): number {
  if (session.state.status === "ended") return 0;
  const card = readCard(L, session);
  if (card) card.cancelToGrave = lua.lua_isnoneornil(L, 2) ? true : lua.lua_toboolean(L, 2);
  return 0;
}

function chainLinkByLuaIndex<EffectRecord extends LuaCardApiEffectRecord>(
  session: DuelSession,
  requestedIndex: number,
  hostState: LuaCardApiState<EffectRecord>,
): DuelSession["state"]["chain"][number] | undefined {
  if (requestedIndex <= 0) return hostState.activeContext?.chainLink ?? session.state.chain[session.state.chain.length - 1];
  return session.state.chain[requestedIndex - 1];
}

function isCardRelatedToChainLink(card: DuelCardInstance, link: DuelSession["state"]["chain"][number]): boolean {
  if (!isOnFieldLocation(link.activationLocation)) return true;
  return card.location === link.activationLocation && card.sequence === link.activationSequence;
}

function readCard(L: unknown, session: DuelSession, index = 1): DuelCardInstance | undefined {
  const uid = readTableStringField(L, index, "__duel_uid");
  return uid ? session.state.cards.find((card) => card.uid === uid) : undefined;
}

function isOnField(card: DuelCardInstance): boolean {
  return card.location === "monsterZone" || card.location === "spellTrapZone";
}

function isOnFieldLocation(location: DuelCardInstance["location"] | undefined): boolean {
  return location === "monsterZone" || location === "spellTrapZone";
}

function setCardTarget(card: DuelCardInstance | undefined, target: DuelCardInstance | undefined): boolean {
  if (!card || !target) return false;
  card.cardTargetUids = card.cardTargetUids ?? [];
  if (!card.cardTargetUids.includes(target.uid)) card.cardTargetUids.push(target.uid);
  return true;
}

function ownerTargetUids(session: DuelSession, card: DuelCardInstance | undefined): string[] {
  if (!card) return [];
  return session.state.cards.filter((candidate) => candidate.cardTargetUids?.includes(card.uid)).map((candidate) => candidate.uid);
}

function isRelatedToBattle(session: DuelSession, uid: string): boolean {
  const battle = session.state.currentAttack ?? session.state.pendingBattle;
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  return Boolean(card && card.location === "monsterZone" && (battle?.attackerUid === uid || battle?.targetUid === uid));
}
