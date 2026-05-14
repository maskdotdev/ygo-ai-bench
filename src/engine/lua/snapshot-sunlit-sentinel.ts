import { hasZoneSpace } from "#duel/card-state.js";
import { specialSummonDuelCard } from "#duel/core.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaSunlitSentinelCode = "78360952";
const luaPhaseStandbyEventCode = 0x1002;

export function isKnownSunlitSentinelDelayedStandbyEffect(effect: SerializedDuelEffect): boolean {
  return (
    Boolean(effect.registryKey?.startsWith(`lua:${luaSunlitSentinelCode}:`)) &&
    effect.event === "trigger" &&
    effect.code === luaPhaseStandbyEventCode &&
    effect.sourceUid !== undefined &&
    effect.targetRange === undefined &&
    effect.countLimit === 1 &&
    effect.luaConditionDescriptor === "condition:source-turn-next" &&
    effect.range.length === 1 &&
    effect.range[0] === "graveyard"
  );
}

export function sunlitSentinelDelayedStandbyOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    try {
      if (ctx.source.location !== "graveyard" || !hasZoneSpace(ctx.duel, ctx.player, "monsterZone")) return;
      specialSummonDuelCard(ctx.duel, ctx.source.uid, ctx.player, ctx.player, { eventReasonCardUid: effect.sourceUid });
    } catch {
      // EDOPro-style delayed operations ignore handlers that can no longer move.
    }
  };
}
