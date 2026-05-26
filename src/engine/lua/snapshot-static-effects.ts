import type { SerializedDuelEffect } from "#duel/types.js";

const luaEffectDoubleSnareValidity = 3682106;
const luaStaticPlayerPhaseLockCodes = new Set([183, 184, 185, 186, 187, 189]);
const luaPhaseEndResetFlags = 0x40000000 | 0x200;

export function isKnownDoubleSnareValidityEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.code === luaEffectDoubleSnareValidity &&
    effect.sourceUid !== undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.targetRange === undefined &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined
  );
}

export function isKnownTrapMonsterDisableEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.code === 10 &&
    effect.event === "continuous" &&
    (effect.targetRange !== undefined || (
      effect.sourceUid !== undefined &&
      effect.reset?.flags !== undefined &&
      effect.range.length === 1 &&
      effect.range[0] === "monsterZone"
    )) &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined
  );
}

export function isStaticPlayerPhaseLock(effect: SerializedDuelEffect): boolean {
  return (
    effect.code !== undefined &&
    luaStaticPlayerPhaseLockCodes.has(effect.code) &&
    effect.targetRange !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined
  );
}
