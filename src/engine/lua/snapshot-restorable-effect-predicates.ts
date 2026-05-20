import { duelLocations } from "#duel/location-kinds.js";
import { setcodeOrCodeTypeTargetDescriptor } from "#lua/snapshot-target-callbacks.js";
import type { SerializedDuelEffect } from "#duel/types.js";

const luaEffectGeminiStatus = 75;
const luaEffectAddType = 115;
const luaEffectRemainField = 17;
const luaEffectIndestructibleBattle = 42;
const luaTypeSpirit = 0x200;
const luaTypeTuner = 0x1000;
const luaResetEvent = 0x1000;
const luaResetPhase = 0x40000000;
const luaResetOpponentTurn = 0x20000000;
const luaPhaseEnd = 0x200;
const luaPhaseEndEventCode = luaResetEvent | luaPhaseEnd;
const luaPhaseEndResetFlags = luaResetPhase | luaPhaseEnd;
const luaResetsStandardPhaseEnd = 0x41fe1200;
const luaResetEventStandard = luaResetEvent | 0x1fe0000;
const luaResetChain = 0x80000000;
const luaValueCardNotHandlerDescriptor = "value-card:not-handler";
const luaCannotActivateSpecialSummonedMonsterDescriptor = "cannot-activate:special-summoned-monster-on-field";
const luaCannotActivateNonSpiritMonsterDescriptor = "cannot-activate:non-spirit-monster-effect";
const luaCannotActivateLocationMonsterPrefix = "cannot-activate:location-monster-effect:";
const luaSourceControllerConditionDescriptor = "condition:source-controller";

export function isKnownCannotBeMaterialEffect(effect: SerializedDuelEffect): boolean {
  if (effect.event !== "continuous") return false;
  if ([235, 236, 238, 239, 248].includes(effect.code ?? -1)) return effect.luaValueDescriptor?.startsWith("cannot-material:") === true || effect.value !== undefined;
  return (
    effect.code === 43 &&
    effect.sourceUid !== undefined &&
    effect.reset !== undefined &&
    effect.luaValueDescriptor?.startsWith("cannot-material:target-not-") === true
  );
}

export function isKnownGeminiStatusEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === luaEffectGeminiStatus &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone"
  );
}

export function isKnownRemainFieldEffect(effect: SerializedDuelEffect): boolean {
  return effect.code === luaEffectRemainField && effect.sourceUid !== undefined && effect.reset?.flags === luaResetChain && effect.targetRange === undefined && effect.range.includes("spellTrapZone");
}

export function isKnownGeminiEndPhaseReturnEffect(effect: SerializedDuelEffect, snapshotEffects: SerializedDuelEffect[]): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaResetsStandardPhaseEnd &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    snapshotEffects.some((candidate) => candidate.sourceUid === effect.sourceUid && isKnownGeminiStatusEffect(candidate))
  );
}

export function isKnownSpiritAddTypeEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === luaEffectAddType &&
    effect.value === luaTypeSpirit &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.reset?.flags === luaResetEventStandard &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone"
  );
}

export function isKnownTemporaryTunerAddTypeEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === luaEffectAddType &&
    effect.value === luaTypeTuner &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.reset?.flags === luaResetEventStandard &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone"
  );
}

export function isKnownGrantedSpiritEndPhaseReturnEffect(effect: SerializedDuelEffect, snapshotEffects: SerializedDuelEffect[]): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaResetEventStandard &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    snapshotEffects.some((candidate) => candidate.sourceUid === effect.sourceUid && isKnownSpiritAddTypeEffect(candidate))
  );
}

export function isKnownCannotActivateSpecialSummonedMonsterEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 6 &&
    effect.luaValueDescriptor === luaCannotActivateSpecialSummonedMonsterDescriptor &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.targetRange?.[0] === 1 &&
    effect.targetRange?.[1] === 0 &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownCannotActivateNonSpiritMonsterEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 6 &&
    effect.luaValueDescriptor === luaCannotActivateNonSpiritMonsterDescriptor &&
    effect.targetRange?.[0] === 1 &&
    effect.targetRange?.[1] === 1 &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone"
  );
}

export function isKnownCannotActivateLocationMonsterEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 6 &&
    effect.luaValueDescriptor?.startsWith(luaCannotActivateLocationMonsterPrefix) === true &&
    effect.targetRange?.[0] === 1 &&
    effect.targetRange?.[1] === 1 &&
    effect.range.length === 1 &&
    effect.range[0] === "spellTrapZone"
  );
}

export function isKnownSetcodeOrCodeTypeBattleProtectionEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    (effect.code === 201 || effect.code === luaEffectIndestructibleBattle) &&
    effect.value === 1 &&
    setcodeOrCodeTypeTargetDescriptor(effect.luaTargetDescriptor) !== undefined &&
    isPhaseEndOrOpponentPhaseEndReset(effect.reset?.flags) &&
    effect.targetRange?.[0] === 4 &&
    effect.targetRange?.[1] === 0 &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function isKnownCannotSelectBattleTargetNotHandlerEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    effect.code === 332 &&
    effect.luaValueDescriptor === luaValueCardNotHandlerDescriptor &&
    effect.luaConditionDescriptor === luaSourceControllerConditionDescriptor &&
    effect.reset?.flags === luaResetEventStandard &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone" &&
    effect.targetRange?.[0] === 0 &&
    effect.targetRange?.[1] === 0x04
  );
}

function isPhaseEndOrOpponentPhaseEndReset(flags: number | undefined): boolean {
  return flags === luaPhaseEndResetFlags || flags === (luaPhaseEndResetFlags | luaResetOpponentTurn);
}

function hasDefaultLuaFieldRange(effect: SerializedDuelEffect): boolean {
  const allLocations = new Set(duelLocations);
  return effect.range.length === allLocations.size && effect.range.every((location) => allLocations.has(location));
}
