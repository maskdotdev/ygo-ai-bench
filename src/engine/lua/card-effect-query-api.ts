import fengari from "fengari";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { moveDuelCard } from "#duel/core.js";
import { readTableNumberField, readTableStringField } from "#lua/api-utils.js";
import { pushCardTable } from "#lua/card-api.js";
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
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanBeDisabledByEffect(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("IsCanBeDisabledByEffect"));
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
  return card.faceUp && (card.location === "monsterZone" || card.location === "spellTrapZone") && !isCardDisabled(state, card, createLuaMaterialCheckContext(state));
}

export function matchingLuaEffects<EffectRecord extends LuaCardApiEffectRecord>(
  state: DuelState,
  card: DuelCardInstance,
  code: number,
  hostState: LuaCardApiState<EffectRecord>,
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
  const immune = matchingLuaEffects(session.state, card, 1, hostState).some((effect) => immuneEffectApplies(L, effect, targetEffect, hostState));
  lua.lua_pushboolean(L, immune);
  return 1;
}

function pushIsCanBeEffectTarget<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const effectId = lua.lua_istable(L, 2) ? readTableNumberField(L, 2, "__effect_id") : undefined;
  const targetEffect = effectId === undefined ? undefined : hostState.effects.get(effectId);
  if (!card) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  if (targetEffect && ((targetEffect.property ?? 0) & 0x80) === 0 && matchingLuaEffects(session.state, card, 1, hostState).some((effect) => immuneEffectApplies(L, effect, targetEffect, hostState))) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const cannotTarget = matchingLuaEffects(session.state, card, 71, hostState).some((effect) => cannotTargetEffectApplies(L, effect, card, targetEffect, hostState));
  lua.lua_pushboolean(L, !cannotTarget);
  return 1;
}

function pushIsCanBeDisabledByEffect<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  const card = readCard(L, session);
  const effectId = lua.lua_istable(L, 2) ? readTableNumberField(L, 2, "__effect_id") : undefined;
  const targetEffect = effectId === undefined ? undefined : hostState.effects.get(effectId);
  const immune = card && targetEffect && ((targetEffect.property ?? 0) & 0x80) === 0 && matchingLuaEffects(session.state, card, 1, hostState).some((effect) => immuneEffectApplies(L, effect, targetEffect, hostState));
  lua.lua_pushboolean(L, Boolean(card && isNegatableCard(session.state, card) && !immune));
  return 1;
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readTableStringField(L, 1, "__duel_uid");
  return uid ? session.state.cards.find((card) => card.uid === uid) : undefined;
}

function immuneEffectApplies<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  immuneEffect: EffectRecord,
  targetEffect: EffectRecord,
  hostState: LuaCardApiState<EffectRecord>,
): boolean {
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

function cannotTargetEffectApplies<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
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
  lua.lua_pushinteger(L, targetEffect.sourceUid === undefined ? 0 : targetEffect.sourceUid === cannotTargetEffect.sourceUid ? 0 : 1);
  const status = lua.lua_pcall(L, 3, 1, 0);
  if (status !== lua.LUA_OK) {
    lua.lua_pop(L, 1);
    return false;
  }
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
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
  if ((effect.property ?? 0) === 0 || ((effect.property ?? 0) & 0x800) === 0) return source.controller === card.controller;
  const [selfTarget = 0, opponentTarget = 0] = effect.targetRange ?? [1, 0];
  return source.controller === card.controller ? selfTarget !== 0 : opponentTarget !== 0;
}
