import fengari from "fengari";
import { registerEffect } from "#duel/core.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { installCardAdjacentApi } from "#lua/card-adjacent-api.js";
import { installCardBattleApi } from "#lua/card-battle-api.js";
import { installCardCodeApi } from "#lua/card-code-api.js";
import { installCardColumnApi } from "#lua/card-column-api.js";
import { installCardControlApi } from "#lua/card-control-api.js";
import { installCardCounterApi } from "#lua/card-counter-api.js";
import { createLuaMaterialCheckContext, installCardEffectQueryApi, matchingLuaEffects } from "#lua/card-effect-query-api.js";
import { installCardEquipApi } from "#lua/card-equip-api.js";
import { installCardFlagApi } from "#lua/card-flag-api.js";
import { installCardLinkApi } from "#lua/card-link-api.js";
import { installCardLinkedApi } from "#lua/card-linked-api.js";
import { installCardMaterialApi } from "#lua/card-material-api.js";
import { installCardMoveAbilityApi } from "#lua/card-move-ability-api.js";
import { installCardOverlayApi } from "#lua/card-overlay-api.js";
import { installCardPreviousStateApi } from "#lua/card-previous-state-api.js";
import { installCardReasonApi } from "#lua/card-reason-api.js";
import { installCardRelationApi } from "#lua/card-relation-api.js";
import { installCardRushApi } from "#lua/card-rush-api.js";
import { installCardStatApi } from "#lua/card-stat-api.js";
import { installCardStateApi } from "#lua/card-state-api.js";
import { installCardStatusApi } from "#lua/card-status-api.js";
import { installCardSummonApi } from "#lua/card-summon-api.js";
import { installCardSummonPredicateApi } from "#lua/card-summon-predicate-api.js";
import { installCardTableApi, pushCardTable } from "#lua/card-table-api.js";
import { installCardTypePredicateApi } from "#lua/card-type-predicate-api.js";
import {
  readCardUid,
  readTableNumberField,
  readTableStringField,
} from "#lua/api-utils.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelSession, DuelState, PlayerId } from "#duel/types.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";

const { lua, to_luastring } = fengari;

export type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";
export { cardFieldId } from "#lua/card-state-api.js";
export { pushCardTable } from "#lua/card-table-api.js";

export function installCardApi<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
  toDuelEffect: (card: DuelCardInstance, luaEffect: EffectRecord, state: unknown) => DuelEffectDefinition,
): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const cardUid = readTableStringField(state, 1, "__duel_uid");
    const effectId = readTableNumberField(state, 2, "__effect_id");
    const card = cardUid ? session.state.cards.find((candidate) => candidate.uid === cardUid) : undefined;
    const luaEffect = effectId === undefined ? undefined : hostState.effects.get(effectId);
    if (!card || !luaEffect) return 0;
    registerEffect(session, toDuelEffect(card, luaEffect, state));
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("RegisterEffect"));
  installCardTableApi(L);
  installCardCodeApi(L, session);
  installCardStatApi(L, session);
  installCardBattleApi(L, session, hostState);
  installCardLinkApi(L, session);
  installCardReasonApi(L, session, hostState);
  installCardStatusApi(L, session, hostState);
  installStateHelpers(L, session, hostState);
  installCardFlagApi(L, session);
  lua.lua_setglobal(L, to_luastring("Card"));
}

function installStateHelpers<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): void {
  installCardStateApi(L, session);
  installCardOverlayApi(L, session, hostState);
  installCardEquipApi(L, session, hostState);
  installCardCounterApi(L, session);
  installCardRushApi(L, session, hostState);
  installCardTypePredicateApi(L, session);
  installCardLinkedApi(L, session);
  pushBooleanGetter(L, "IsDrone", session, (card) => Boolean(card?.data.setcodes?.includes(0x581)));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsRikkaReleasable(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsRikkaReleasable"));
  pushBooleanGetter(L, "IsForbidden", session, () => false);
  pushBooleanGetter(L, "IsDisabled", session, (card) => Boolean(card && isCardDisabled(session.state, card, createLuaMaterialCheckContext(session.state))));
  installCardAdjacentApi(L, session, hostState);
  pushBooleanGetter(L, "IsMaximumMode", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeCenter", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeLeft", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeRight", session, () => false);
  pushBooleanGetter(L, "IsMaximumModeSide", session, () => false);
  pushBooleanGetter(L, "IsNotMaximumModeSide", session, () => true);
  pushBooleanGetter(L, "WasMaximumMode", session, () => false);
  pushBooleanGetter(L, "WasMaximumModeCenter", session, () => false);
  pushBooleanGetter(L, "WasMaximumModeSide", session, () => false);
  installCardPreviousStateApi(L, session);
  installCardColumnApi(L, session);
  installCardControlApi(L, session);
  installCardSummonApi(L, session);
  installCardMoveAbilityApi(L, session);
  installCardRelationApi(L, session, hostState);
  pushBooleanGetter(L, "IsRelateToBattle", session, (_, uid) => Boolean(uid && isRelatedToBattle(session.state, uid)));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    if (card) card.cancelToGrave = lua.lua_isnoneornil(state, 2) ? true : lua.lua_toboolean(state, 2);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("CancelToGrave"));
  installCardEffectQueryApi(L, session, hostState);
  installCardSummonPredicateApi(L, session);
  installCardMaterialApi(L, session);
}

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined, uid: string | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    lua.lua_pushboolean(state, getter(card, uid));
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

function readCard(L: unknown, session: DuelSession | undefined): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid && session ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function isRelatedToBattle(state: DuelState, uid: string): boolean {
  const battle = state.currentAttack ?? state.pendingBattle;
  return battle?.attackerUid === uid || battle?.targetUid === uid;
}
