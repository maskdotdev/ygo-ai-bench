import { findCard } from "#duel/card-state.js";
import { continuousEffectTargetsPlayer } from "#duel/continuous-effects.js";
import { createEffectContext } from "#duel/effect-context.js";
import { availableFieldZoneCount, firstOpenFieldZoneSequence } from "#duel/disabled-field-zones.js";
import type { DuelCardInstance, DuelState, PlayerId } from "#duel/types.js";

const effectForceMonsterZone = 265;
const mainMonsterZoneMask = 0x1f;

export function forcedMonsterZoneAllowedMask(state: DuelState, player: PlayerId, reason = 0, card?: DuelCardInstance, inactiveSourceUids: readonly string[] = []): number {
  let allowedMask = mainMonsterZoneMask;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== effectForceMonsterZone) continue;
    if (inactiveSourceUids.includes(effect.sourceUid)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectTargetsPlayer(effect, source, player)) continue;
    const ctx = createEffectContext(state, source, effect.controller, undefined, card, [], true);
    ctx.eventReason = reason;
    ctx.eventReasonPlayer = player;
    const value = effect.forceMonsterZoneValue?.(ctx, player, reason) ?? effect.value;
    if (value === undefined) continue;
    allowedMask &= value & mainMonsterZoneMask;
  }
  return allowedMask;
}

export function availableForcedMonsterZoneCount(state: DuelState, player: PlayerId, excludedUids: readonly string[] = [], zoneMask = 0, reason = 0, card?: DuelCardInstance): number {
  const forcedMask = forcedMonsterZoneAllowedMask(state, player, reason, card, excludedUids);
  const effectiveMask = zoneMask === 0 ? forcedMask : zoneMask & forcedMask;
  if (effectiveMask === 0) return 0;
  return availableFieldZoneCount(state, player, "monsterZone", excludedUids, effectiveMask);
}

export function firstOpenForcedMonsterZoneSequence(state: DuelState, player: PlayerId, excludedUids: readonly string[] = [], zoneMask = 0, reason = 0, card?: DuelCardInstance): number | undefined {
  const forcedMask = forcedMonsterZoneAllowedMask(state, player, reason, card, excludedUids);
  const effectiveMask = zoneMask === 0 ? forcedMask : zoneMask & forcedMask;
  if (effectiveMask === 0) return undefined;
  return firstOpenFieldZoneSequence(state, player, "monsterZone", excludedUids, effectiveMask);
}
