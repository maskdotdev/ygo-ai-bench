import type { SerializedDuelEffect } from "#duel/types.js";

const luaEffectFlagPlayerTarget = 0x800;
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

function hasDefaultLuaFieldRange(effect: SerializedDuelEffect): boolean {
  const allLocations = new Set(["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"]);
  return effect.range.length === allLocations.size && effect.range.every((location) => allLocations.has(location));
}
