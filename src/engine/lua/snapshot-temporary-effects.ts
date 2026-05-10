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

function isKnownTemporaryPlayerBattleDamageAvoidEffect(effect: SerializedDuelEffect): boolean {
  return isPlainTemporaryStaticValueEffect(effect, 201) && hasPlayerTargetFlag(effect) && targetRangeEquals(effect, 1, 0);
}

function isKnownTemporaryMonsterBattleIndestructibleEffect(effect: SerializedDuelEffect): boolean {
  return isPlainTemporaryStaticValueEffect(effect, 42) && !hasPlayerTargetFlag(effect) && targetRangeEquals(effect, luaLocationMonsterZone, 0);
}

function isPlainTemporaryStaticValueEffect(effect: SerializedDuelEffect, code: number): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === code &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.value === 1 &&
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

function hasDefaultLuaFieldRange(effect: SerializedDuelEffect): boolean {
  const allLocations = new Set(["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"]);
  return effect.range.length === allLocations.size && effect.range.every((location) => allLocations.has(location));
}
