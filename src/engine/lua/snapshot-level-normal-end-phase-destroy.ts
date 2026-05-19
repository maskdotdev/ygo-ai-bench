import { cardTypeFlags, currentLevel } from "#duel/card-stats.js";
import { destroyDuelCard } from "#duel/core.js";
import { duelLocations } from "#duel/location-kinds.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaTrianglePowerCode = "32298781";
const luaThousandEnergyCode = "5703682";
const luaResetPhase = 0x40000000;
const luaPhaseEnd = 0x200;
const luaPhaseEndEventCode = 0x1000 | luaPhaseEnd;
const luaPhaseEndResetFlags = luaResetPhase | luaPhaseEnd;
const luaTypeNormal = 0x10;

export function isKnownLevelNormalEndPhaseDestroyEffect(effect: SerializedDuelEffect): boolean {
  return (
    levelNormalEndPhaseDestroyLevel(effect) !== undefined &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.controller !== undefined &&
    effect.countLimit === 1 &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function levelNormalEndPhaseDestroyCanActivate(effect: SerializedDuelEffect): NonNullable<DuelEffectDefinition["canActivate"]> {
  return (ctx) => {
    const level = levelNormalEndPhaseDestroyLevel(effect);
    return level !== undefined && ctx.duel.cards.some((card) => {
      return card.controller === effect.controller &&
        card.location === "monsterZone" &&
        card.faceUp &&
        (cardTypeFlags(card, ctx.duel) & luaTypeNormal) !== 0 &&
        currentLevel(card, ctx.duel) === level;
    });
  };
}

export function levelNormalEndPhaseDestroyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const level = levelNormalEndPhaseDestroyLevel(effect);
    if (level === undefined || effect.controller === undefined) return;
    const targets = ctx.duel.cards
      .filter((card) => card.controller === effect.controller && card.location === "monsterZone" && card.faceUp && (cardTypeFlags(card, ctx.duel) & luaTypeNormal) !== 0 && currentLevel(card, ctx.duel) === level)
      .sort((a, b) => a.sequence - b.sequence);
    for (const card of targets) {
      try {
        destroyDuelCard(ctx.duel, card.uid, card.controller, duelReason.effect | duelReason.destroy, effect.controller, "graveyard", {
          eventReasonCardUid: effect.sourceUid,
        });
      } catch {
        // EDOPro-style grouped destruction ignores targets that are no longer destroyable.
      }
    }
  };
}

function levelNormalEndPhaseDestroyLevel(effect: SerializedDuelEffect): number | undefined {
  const registryCode = effect.registryKey?.match(/^lua:(\d+):/)?.[1];
  if (registryCode === luaTrianglePowerCode) return 1;
  if (registryCode === luaThousandEnergyCode) return 2;
  return undefined;
}

function hasDefaultLuaFieldRange(effect: SerializedDuelEffect): boolean {
  const allLocations = new Set(duelLocations);
  return effect.range.length === allLocations.size && effect.range.every((location) => allLocations.has(location));
}
