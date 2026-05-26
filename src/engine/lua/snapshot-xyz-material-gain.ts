import { duelLocations } from "#duel/location-kinds.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaEffectAddType = 115;
const luaResetEvent = 0x1000;
const luaResetEventStandard = luaResetEvent | 0x1fe0000;
const luaResetEventStandardDisable = luaResetEvent | 0x1ff0000;
const gagagaGirlCode = 3606728;
const gagagaGirlAttackZeroDescription = gagagaGirlCode * 16 + 1;
const xyzMaterialAttackBoostByDescription = new Map<number, number>([
  [34143852 * 16, 1000],
  [7080743 * 16, 800],
  [45184165 * 16 + 1, 300],
]);

export function isKnownXyzMaterialEffectAddType(effect: SerializedDuelEffect): boolean {
  return effect.event === "continuous" &&
    effect.code === luaEffectAddType &&
    effect.value === 0x20 &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.reset?.flags === luaResetEventStandard &&
    effect.range.length === 1 &&
    effect.range[0] === "monsterZone";
}

export function isKnownXyzMaterialAttackGainTriggerEffect(effect: SerializedDuelEffect): boolean {
  return effect.event === "trigger" &&
    effect.code === 1102 &&
    effect.triggerEvent === "specialSummoned" &&
    effect.triggerCode === 1102 &&
    effect.optional === false &&
    effect.category === 0x200000 &&
    effect.description !== undefined &&
    xyzMaterialAttackBoostByDescription.has(effect.description) &&
    effect.luaConditionDescriptor === "condition:source-summon-type:1224736768" &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaResetEventStandard &&
    hasDefaultLuaFieldRange(effect);
}

export function isKnownGagagaGirlXyzAttackZeroTriggerEffect(effect: SerializedDuelEffect): boolean {
  return effect.event === "trigger" &&
    effect.code === 1102 &&
    effect.triggerEvent === "specialSummoned" &&
    effect.triggerCode === 1102 &&
    effect.optional === true &&
    effect.category === 0x200000 &&
    effect.property === 0x10 &&
    effect.description === gagagaGirlAttackZeroDescription &&
    effect.luaConditionDescriptor === "condition:source-summon-type:1224736768" &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaResetEventStandard &&
    hasDefaultLuaFieldRange(effect);
}

export function xyzMaterialAttackGainOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const boost = effect.description === undefined ? undefined : xyzMaterialAttackBoostByDescription.get(effect.description);
    if (boost === undefined || ctx.source.location !== "monsterZone" || !ctx.source.faceUp) return;
    ctx.duel.effects.push({
      id: `${effect.id}-update-attack`,
      sourceUid: ctx.source.uid,
      controller: effect.controller,
      event: "continuous",
      code: 100,
      value: boost,
      range: ["monsterZone"],
      reset: { flags: luaResetEventStandardDisable },
      operation: () => {},
    });
  };
}

export function gagagaGirlXyzAttackZeroOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const target = ctx.getTargets()[0];
    if (!target || target.location !== "monsterZone" || !target.faceUp) return;
    ctx.duel.effects.push({
      id: `${effect.id}-set-attack-final`,
      sourceUid: target.uid,
      controller: effect.controller,
      event: "continuous",
      code: 102,
      value: 0,
      range: ["monsterZone"],
      reset: { flags: luaResetEventStandard },
      operation: () => {},
    });
  };
}

function hasDefaultLuaFieldRange(effect: SerializedDuelEffect): boolean {
  const allLocations = new Set(duelLocations);
  return effect.range.length === allLocations.size && effect.range.every((location) => allLocations.has(location));
}
