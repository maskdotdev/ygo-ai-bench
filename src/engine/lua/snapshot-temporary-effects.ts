import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaEffectFlagPlayerTarget = 0x800;
const luaEffectFlagClientHint = 0x4000000;
const luaLocationMonsterZone = 0x04;
const luaPhaseEndResetFlags = 0x40000200;
const luaPhaseBattleEndResetFlags = 0x40000280;
const luaSelfTurnPhaseEndResetFlags = 0x50000200;
const luaSelfTurnBattleResetFlags = 0x50000080;
const luaSelfTurnMain1ResetFlags = 0x50000004;
const luaOpponentTurnPhaseEndResetFlags = 0x60000200;
const luaOpponentTurnMain1ResetFlags = 0x60000004;
const luaPhaseDamageResetFlags = 0x40000020;

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

export function isKnownTemporaryCannotAttackEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 85 &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined &&
    !hasPlayerTargetFlag(effect) &&
    targetRangeEquals(effect, luaLocationMonsterZone, 0) &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownPlayerDamageZeroEffect(effect: SerializedDuelEffect): boolean {
  return (
    (isPlainPhaseEndStaticValueEffect(effect, 82, 0) || isPlainPhaseEndStaticValueEffect(effect, 335, 0)) &&
    hasPlayerTargetFlag(effect) &&
    hasAnyPlayerTarget(effect)
  );
}

export function isKnownTemporarySummonSetLockEffect(effect: SerializedDuelEffect): boolean {
  return (effect.code === 20 || effect.code === 23 || effect.code === 24 || effect.code === 69) && isPlainPlayerTargetPhaseEndEffect(effect);
}

export function isKnownTemporaryActivationLockEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 6 &&
    effect.sourceUid !== undefined &&
    (effect.reset?.flags === luaPhaseEndResetFlags || effect.reset?.flags === luaPhaseBattleEndResetFlags || effect.reset?.flags === luaPhaseDamageResetFlags) &&
    (effect.value === 1 || effect.luaValueDescriptor === "cannot-activate:spell-trap-effect" || effect.luaValueDescriptor === "cannot-activate:card-activation" || effect.luaValueDescriptor === "cannot-activate:spell-card-activation" || effect.luaValueDescriptor === "cannot-activate:trap-card-activation" || effect.luaValueDescriptor === "cannot-activate:same-code" || effect.luaValueDescriptor === "cannot-activate:same-code-monster-effect" || effect.luaValueDescriptor?.startsWith("cannot-activate:monster-attribute-except:") === true) &&
    (effect.luaTargetDescriptor === undefined || effect.luaTargetDescriptor === "target:same-code-label") &&
    hasPlayerTargetFlag(effect) &&
    hasAnyPlayerTarget(effect) &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownTemporarySelfTurnSkipBattlePhaseEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 183 &&
    effect.sourceUid !== undefined &&
    (effect.reset?.flags === luaSelfTurnPhaseEndResetFlags || effect.reset?.flags === luaSelfTurnBattleResetFlags) &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined &&
    hasPlayerTargetFlag(effect) &&
    targetRangeEquals(effect, 1, 0) &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function temporarySelfTurnSkipBattlePhaseCanActivate(effect: SerializedDuelEffect): DuelEffectDefinition["canActivate"] | undefined {
  return isKnownTemporarySelfTurnSkipBattlePhaseEffect(effect) && effect.label !== undefined && effect.reset?.count === 2
    ? (ctx) => ctx.duel.turn !== effect.label
    : undefined;
}

export function isKnownTemporaryOpponentTurnSkipMain1Effect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 182 &&
    effect.sourceUid !== undefined &&
    (effect.reset?.flags === luaOpponentTurnPhaseEndResetFlags || effect.reset?.flags === luaOpponentTurnMain1ResetFlags) &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined &&
    hasPlayerTargetFlag(effect) &&
    targetRangeEquals(effect, 0, 1) &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function temporaryOpponentTurnSkipMain1CanActivate(effect: SerializedDuelEffect): DuelEffectDefinition["canActivate"] | undefined {
  return isKnownTemporaryOpponentTurnSkipMain1Effect(effect) && effect.label !== undefined ? (ctx) => ctx.duel.turn !== effect.label : undefined;
}

export function isKnownTemporarySelfTurnCannotEndPhaseEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 187 &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaSelfTurnMain1ResetFlags &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined &&
    hasPlayerTargetFlag(effect) &&
    targetRangeEquals(effect, 1, 0) &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownTemporarySameCodeActivationOathEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 6 &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.reset.count !== undefined &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined &&
    hasPlayerTargetFlag(effect) &&
    targetRangeEquals(effect, 1, 0) &&
    hasDefaultLuaFieldRange(effect) &&
    ((effect.property ?? 0) & luaEffectFlagClientHint) !== 0
  );
}

export function isKnownTemporaryOpponentTurnSkipTurnEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 188 &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaOpponentTurnPhaseEndResetFlags &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined &&
    hasPlayerTargetFlag(effect) &&
    targetRangeEquals(effect, 0, 1) &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownTemporaryOpponentCannotBattlePhaseEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 185 &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined &&
    hasPlayerTargetFlag(effect) &&
    targetRangeEquals(effect, 0, 1) &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownTemporaryOpponentTurnSkipMain2Effect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 184 &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaOpponentTurnPhaseEndResetFlags &&
    effect.value === undefined &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined &&
    hasPlayerTargetFlag(effect) &&
    targetRangeEquals(effect, 0, 1) &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownTemporaryArtifactLanceaBanishLockEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    (effect.code === 67 || effect.code === 30459350) &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.luaValueDescriptor === undefined &&
    effect.luaTargetDescriptor === undefined &&
    hasPlayerTargetFlag(effect) &&
    targetRangeEquals(effect, 1, 1) &&
    hasDefaultLuaFieldRange(effect) &&
    (effect.code !== 67 || effect.value === 1)
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
    (effect.luaTargetDescriptor === undefined || effect.luaTargetDescriptor === "target:same-code-label") &&
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
