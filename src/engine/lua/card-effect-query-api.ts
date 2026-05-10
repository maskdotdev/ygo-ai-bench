import fengari from "fengari";
import { isCardDisabled, isDisablePrevented } from "#duel/continuous-effects.js";
import { canMoveDuelCardToLocation, moveDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { readTableNumberField, readTableStringField } from "#lua/api-utils.js";
import { pushCardTable } from "#lua/card-api.js";
import { isMonsterLike } from "#lua/card-eligibility-api.js";
import { cardTypeFlags } from "#lua/card-stat-api.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api.js";
import type { ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelLocation, DuelSession, DuelState, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardEffectQueryApi<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushIsImmuneToEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsImmuneToEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanBeEffectTarget(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsCanBeEffectTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsDestructable(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsDestructable"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanBeDisabledByEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsCanBeDisabledByEffect"));
  pushBooleanGetter(L, "IsDisabled", session, (card) => Boolean(card && isCardDisabled(session.state, card, createLuaMaterialCheckContext(session.state))));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsHasEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsHasEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsHasEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetCardEffect"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetActivateEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetActivateEffect"));
  pushBooleanGetter(L, "IsNegatable", session, (card) => Boolean(card && isNegatableCard(session.state, card)));
  pushBooleanGetter(L, "IsNegatableMonster", session, (card) => Boolean(card && isMonsterLike(card) && isNegatableCard(session.state, card)));
  pushBooleanGetter(L, "IsNegatableSpellTrap", session, (card) => Boolean(card && (cardTypeFlags(card, session.state) & 0x6) !== 0 && isNegatableCard(session.state, card)));
}

export function createLuaMaterialCheckContext(state: DuelState): ContinuousEffectContextFactory {
  return (effect, source, card) => ({
    duel: state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: card ? [card.uid] : [],
    log() {},
    moveCard(uid: string, to: DuelLocation, controller?: PlayerId) {
      return moveDuelCard(state, uid, to, controller);
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return card ? [card] : [];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}

export function isNegatableCard(state: DuelState, card: DuelCardInstance): boolean {
  if (!card.faceUp || (card.location !== "monsterZone" && card.location !== "spellTrapZone")) return false;
  if (card.location === "monsterZone" && (cardTypeFlags(card, state) & 0x10) !== 0 && !state.effects.some((effect) => effect.sourceUid === card.uid)) return false;
  return !isCardDisabled(state, card, createLuaMaterialCheckContext(state));
}

export function matchingLuaEffects<EffectRecord extends LuaCardApiEffectRecord>(
  state: DuelState,
  card: DuelCardInstance,
  code: number,
  hostState: { effects: ReadonlyMap<number, EffectRecord> },
): EffectRecord[] {
  const matches: EffectRecord[] = [];
  const seen = new Set<number>();
  for (const luaEffect of hostState.effects.values()) {
    if (luaEffect.code !== code || seen.has(luaEffect.id)) continue;
    const duelEffect = state.effects.find((candidate) => candidate.id === luaEffectDuelId(luaEffect) && candidate.sourceUid === luaEffect.sourceUid);
    const source = duelEffect ? state.cards.find((candidate) => candidate.uid === duelEffect.sourceUid) : undefined;
    if (!duelEffect || !source || !isEffectActiveForCard(duelEffect, luaEffect, source, card, state)) continue;
    seen.add(luaEffect.id);
    matches.push(luaEffect);
  }
  return matches;
}

function pushIsImmuneToEffect<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const effectId = lua.lua_istable(L, 2) ? readTableNumberField(L, 2, "__effect_id") : undefined;
  const targetEffect = effectId === undefined ? undefined : hostState.effects.get(effectId);
  if (!card || !targetEffect || ((targetEffect.property ?? 0) & 0x80) !== 0) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const immune = luaCardIsImmuneToEffect(L, session, hostState, card, targetEffect);
  lua.lua_pushboolean(L, immune);
  return 1;
}

function pushIsCanBeEffectTarget<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const effectId = lua.lua_istable(L, 2) ? readTableNumberField(L, 2, "__effect_id") : undefined;
  const targetEffect = effectId === undefined ? undefined : hostState.effects.get(effectId);
  lua.lua_pushboolean(L, canLuaCardBeEffectTarget(L, session, hostState, card, targetEffect));
  return 1;
}

export function canLuaCardBeEffectTarget<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
  card: DuelCardInstance | undefined,
  targetEffect: EffectRecord | undefined,
): boolean {
  if (!card) return false;
  const immune = luaCardIsImmuneToEffect(L, session, hostState, card, targetEffect);
  if (immune) return false;
  if (restoredDuelEffectPreventsTargeting(session, card, targetEffect)) return false;
  return !matchingLuaEffects(session.state, card, 71, hostState).some((effect) => cannotTargetEffectApplies(L, session, effect, card, targetEffect, hostState));
}

function restoredDuelEffectPreventsTargeting(session: DuelSession, card: DuelCardInstance, targetEffect: LuaCardApiEffectRecord | undefined): boolean {
  const targetPlayer = targetEffect ? effectOwnerPlayer(session, targetEffect) : undefined;
  for (const effect of session.state.effects) {
    if (effect.event !== "continuous" || effect.code !== 71 || effect.sourceUid !== card.uid) continue;
    const source = session.state.cards.find((candidate) => candidate.uid === effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createLuaMaterialCheckContext(session.state)(effect, source, card);
    if (targetEffect) ctx.relatedEffectId = targetEffect.id;
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    if (effect.targetCardPredicate && !effect.targetCardPredicate(ctx, card)) continue;
    if (!luaEffectTargetingValueUsesRelatedEffectArgs(effect) && effect.valueCardPredicate && !effect.valueCardPredicate(ctx, card)) continue;
    if (effect.valuePredicate) {
      if (targetPlayer === undefined || !effect.valuePredicate(ctx, targetPlayer)) continue;
    } else if ((effect.value ?? 1) === 0) continue;
    return true;
  }
  return false;
}

function luaEffectTargetingValueUsesRelatedEffectArgs(effect: DuelEffectDefinition): boolean {
  return effect.id.startsWith("lua-") && effect.code === 71;
}

function pushIsCanBeDisabledByEffect<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const effectId = lua.lua_istable(L, 2) ? readTableNumberField(L, 2, "__effect_id") : undefined;
  const targetEffect = effectId === undefined ? undefined : hostState.effects.get(effectId);
  const immune = card && luaCardIsImmuneToEffect(L, session, hostState, card, targetEffect);
  lua.lua_pushboolean(L, Boolean(card && isNegatableCard(session.state, card) && !immune && !isDisablePrevented(session.state, card, createLuaMaterialCheckContext(session.state))));
  return 1;
}

function pushIsDestructable<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const effectId = lua.lua_istable(L, 2) ? readTableNumberField(L, 2, "__effect_id") : undefined;
  const targetEffect = effectId === undefined ? undefined : hostState.effects.get(effectId);
  const reason = duelReason.effect | duelReason.destroy;
  if (!card || !canMoveDuelCardToLocation(session.state, card.uid, "graveyard", reason)) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  if (luaCardIsImmuneToEffect(L, session, hostState, card, targetEffect)) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const protectedByEffect = matchingLuaEffects(session.state, card, 41, hostState).some((effect) => indestructibleEffectApplies(L, session, effect, targetEffect, hostState));
  lua.lua_pushboolean(L, !protectedByEffect);
  return 1;
}

function pushIsHasEffect<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const code = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  if (!card || code === undefined) return 0;
  const effects = matchingLuaEffects(session.state, card, code, hostState);
  if (effects.length === 0) {
    lua.lua_pushnil(L);
    return 1;
  }
  for (const effect of effects) hostState.pushEffectTable(L, effect.id);
  return effects.length;
}

function pushGetActivateEffect<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const effect = card ? [...hostState.effects.values()].find((candidate) => candidate.sourceUid === card.uid && ((candidate.typeFlags ?? 0) & 0x10) !== 0) : undefined;
  if (!effect) lua.lua_pushnil(L);
  else hostState.pushEffectTable(L, effect.id);
  return 1;
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
  return uid ? session.state.cards.find((card) => card.uid === uid) : undefined;
}

export function luaCardIsImmuneToEffect<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
  card: DuelCardInstance,
  targetEffect: EffectRecord | undefined,
): boolean {
  if (!targetEffect || ((targetEffect.property ?? 0) & 0x80) !== 0) return false;
  return matchingLuaEffects(session.state, card, 1, hostState).some((effect) => immuneEffectApplies(L, effect, card, targetEffect, hostState));
}

function immuneEffectApplies<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  immuneEffect: EffectRecord,
  card: DuelCardInstance,
  targetEffect: EffectRecord,
  hostState: LuaCardApiState<EffectRecord>,
): boolean {
  if (immuneEffect.targetRef !== undefined && !cardTargetFilterApplies(L, immuneEffect, card, hostState)) return false;
  if (immuneEffect.valueRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, immuneEffect.valueRef);
  hostState.pushEffectTable(L, immuneEffect.id);
  hostState.pushEffectTable(L, targetEffect.id);
  const status = lua.lua_pcall(L, 2, 1, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return false;
  }
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function indestructibleEffectApplies<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  indestructibleEffect: EffectRecord,
  targetEffect: EffectRecord | undefined,
  hostState: LuaCardApiState<EffectRecord>,
): boolean {
  if (indestructibleEffect.valueRef === undefined) return (indestructibleEffect.value ?? 1) !== 0;
  if (!targetEffect) return false;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, indestructibleEffect.valueRef);
  hostState.pushEffectTable(L, indestructibleEffect.id);
  hostState.pushEffectTable(L, targetEffect.id);
  lua.lua_pushinteger(L, effectOwnerPlayer(session, targetEffect));
  const status = lua.lua_pcall(L, 3, 1, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return false;
  }
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function cannotTargetEffectApplies<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  cannotTargetEffect: EffectRecord,
  card: DuelCardInstance,
  targetEffect: EffectRecord | undefined,
  hostState: LuaCardApiState<EffectRecord>,
): boolean {
  if (cannotTargetEffect.targetRef !== undefined && !cardTargetFilterApplies(L, cannotTargetEffect, card, hostState)) return false;
  if (cannotTargetEffect.valueRef === undefined) return (cannotTargetEffect.value ?? 1) !== 0;
  if (!targetEffect) return false;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, cannotTargetEffect.valueRef);
  hostState.pushEffectTable(L, cannotTargetEffect.id);
  hostState.pushEffectTable(L, targetEffect.id);
  lua.lua_pushinteger(L, effectOwnerPlayer(session, targetEffect));
  const status = lua.lua_pcall(L, 3, 1, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return false;
  }
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function effectOwnerPlayer<EffectRecord extends LuaCardApiEffectRecord>(session: DuelSession, effect: EffectRecord): PlayerId {
  if (effect.ownerPlayer !== undefined) return effect.ownerPlayer;
  const source = effect.sourceUid ? session.state.cards.find((card) => card.uid === effect.sourceUid) : undefined;
  return source?.controller ?? 0;
}

function cardTargetFilterApplies<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  effect: EffectRecord,
  card: DuelCardInstance,
  hostState: LuaCardApiState<EffectRecord>,
): boolean {
  if (effect.targetRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, effect.targetRef);
  hostState.pushEffectTable(L, effect.id);
  pushCardTable(L, card.uid);
  const status = lua.lua_pcall(L, 2, 1, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return false;
  }
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function luaEffectDuelId(effect: LuaCardApiEffectRecord): string {
  return `lua-${effect.id}${effect.code === undefined ? "" : `-${effect.code}`}`;
}

function isEffectActiveForCard(effect: DuelEffectDefinition, luaEffect: LuaCardApiEffectRecord, source: DuelCardInstance, card: DuelCardInstance, state: DuelState): boolean {
  if (!effect.range.includes(source.location)) return false;
  if (!continuousEffectAffectsCard(effect, luaEffect, source, card)) return false;
  return !effect.canActivate || effect.canActivate(createLuaMaterialCheckContext(state)(effect, source, card));
}

function continuousEffectAffectsCard(effect: DuelEffectDefinition, luaEffect: LuaCardApiEffectRecord, source: DuelCardInstance, card: DuelCardInstance): boolean {
  if (source.uid === card.uid) return true;
  if (((luaEffect.typeFlags ?? 0) & 0x1) !== 0) return false;
  if (continuousEffectIsPlayerTarget(effect)) return continuousEffectTargetsPlayer(effect, source, card.controller);
  if (effect.targetRange !== undefined) return continuousEffectTargetsCardLocation(effect, source, card);
  return source.controller === card.controller;
}

function continuousEffectIsPlayerTarget(effect: DuelEffectDefinition): boolean {
  if (effect.targetRange && continuousEffectCodeUsesPlayerSelectors(effect.code) && targetRangeUsesPlayerSelectors(effect.targetRange)) return true;
  return ((effect.property ?? 0) & 0x800) !== 0;
}

function continuousEffectCodeUsesPlayerSelectors(code: number | undefined): boolean {
  return code === 14 || code === 57 || code === 59 || code === 204;
}

function targetRangeUsesPlayerSelectors([selfTarget = 0, opponentTarget = 0]: [number, number?]): boolean {
  return isPlayerSelector(selfTarget) && isPlayerSelector(opponentTarget);
}

function isPlayerSelector(value: number): boolean {
  return value === 0 || value === 1;
}

function continuousEffectTargetsPlayer(effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId): boolean {
  const [selfTarget = 0, opponentTarget = 0] = effect.targetRange ?? [1, 0];
  return source.controller === player ? selfTarget !== 0 : opponentTarget !== 0;
}

function continuousEffectTargetsCardLocation(effect: DuelEffectDefinition, source: DuelCardInstance, card: DuelCardInstance): boolean {
  const [selfMask = 0, opponentMask = 0] = effect.targetRange ?? [];
  return locationMaskMatchesCard(card, source.controller === card.controller ? selfMask : opponentMask);
}

function locationMaskMatchesCard(card: DuelCardInstance, mask: number): boolean {
  if ((mask & locationMaskFromLocation(card.location)) !== 0) return true;
  if ((mask & 0x400) !== 0 && card.location === "spellTrapZone") return true;
  if ((mask & 0x800) !== 0 && card.location === "monsterZone" && card.sequence >= 0 && card.sequence <= 4) return true;
  return (mask & 0x1000) !== 0 && card.location === "monsterZone" && card.sequence >= 5 && card.sequence <= 6;
}

function locationMaskFromLocation(location: DuelLocation): number {
  if (location === "deck") return 0x01;
  if (location === "hand") return 0x02;
  if (location === "monsterZone") return 0x04;
  if (location === "spellTrapZone") return 0x08;
  if (location === "graveyard") return 0x10;
  if (location === "banished") return 0x20;
  if (location === "extraDeck") return 0x40;
  if (location === "overlay") return 0x80;
  return 0;
}
