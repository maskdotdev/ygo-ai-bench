import type { SerializedDuelEffect } from "#duel/types.js";

const luaEffectFlagPlayerTarget = 0x800;
const luaLocationMonsterZone = 0x04;
const luaPhaseEndResetFlags = 0x40000200;

export function isKnownTemporaryPlayerAttackAnnounceLockEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 86 &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.targetRange !== undefined &&
    ((effect.property ?? 0) & luaEffectFlagPlayerTarget) !== 0 &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownTemporaryBattleProtectionEffect(effect: SerializedDuelEffect): boolean {
  return isKnownTemporaryPlayerBattleDamageAvoidEffect(effect) || isKnownTemporaryMonsterBattleIndestructibleEffect(effect);
}

export function isKnownPlayerDamageZeroEffect(effect: SerializedDuelEffect): boolean {
  return (
    (isPlainPhaseEndStaticValueEffect(effect, 82, 0) || isPlainPhaseEndStaticValueEffect(effect, 335, 0)) &&
    hasPlayerTargetFlag(effect) &&
    hasAnyPlayerTarget(effect)
  );
}

export function isKnownTemporarySummonSetLockEffect(effect: SerializedDuelEffect): boolean {
  return (effect.code === 20 || effect.code === 23 || effect.code === 24) && isPlainPlayerTargetPhaseEndEffect(effect);
}

export function isKnownTemporaryActivationLockEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 6 &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    (effect.value === 1 || effect.luaValueDescriptor === "cannot-activate:spell-trap-effect") &&
    effect.luaTargetDescriptor === undefined &&
    hasPlayerTargetFlag(effect) &&
    hasAnyPlayerTarget(effect) &&
    hasDefaultLuaFieldRange(effect)
  );
}

function isKnownTemporaryPlayerBattleDamageAvoidEffect(effect: SerializedDuelEffect): boolean {
  return isPlainTemporaryStaticValueEffect(effect, 201) && hasPlayerTargetFlag(effect) && targetRangeEquals(effect, 1, 0);
}

function isPlainPlayerTargetPhaseEndEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined &&
    hasPlayerTargetFlag(effect) &&
    hasAnyPlayerTarget(effect) &&
    hasDefaultLuaFieldRange(effect)
  );
}

function isKnownTemporaryMonsterBattleIndestructibleEffect(effect: SerializedDuelEffect): boolean {
  return isPlainTemporaryStaticValueEffect(effect, 42) && !hasPlayerTargetFlag(effect) && targetRangeEquals(effect, luaLocationMonsterZone, 0);
}

function isPlainTemporaryStaticValueEffect(effect: SerializedDuelEffect, code: number): boolean {
  return isPlainPhaseEndStaticValueEffect(effect, code, 1);
}

function isPlainPhaseEndStaticValueEffect(effect: SerializedDuelEffect, code: number, value: number): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === code &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.value === value &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined &&
    hasDefaultLuaFieldRange(effect)
  );
}

function hasPlayerTargetFlag(effect: SerializedDuelEffect): boolean {
  return ((effect.property ?? 0) & luaEffectFlagPlayerTarget) !== 0;
}

function targetRangeEquals(effect: SerializedDuelEffect, selfTarget: number, opponentTarget: number): boolean {
  return effect.targetRange?.[0] === selfTarget && (effect.targetRange[1] ?? 0) === opponentTarget;
}

function hasAnyPlayerTarget(effect: SerializedDuelEffect): boolean {
  return effect.targetRange?.[0] === 1 || (effect.targetRange?.[1] ?? 0) === 1;
}

function hasDefaultLuaFieldRange(effect: SerializedDuelEffect): boolean {
  const allLocations = new Set(["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"]);
  return effect.range.length === allLocations.size && effect.range.every((location) => allLocations.has(location));
}
