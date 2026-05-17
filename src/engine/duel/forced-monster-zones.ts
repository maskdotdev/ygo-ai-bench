import { findCard } from "#duel/card-state.js";
import { continuousEffectTargetsPlayer } from "#duel/continuous-effects.js";
import { createEffectContext } from "#duel/effect-context.js";
import { availableFieldZoneCount, firstOpenFieldZoneSequence } from "#duel/disabled-field-zones.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelState, PlayerId } from "#duel/types.js";

const effectForceMonsterZone = 265;
const mainMonsterZoneMask = 0x1f;
const effectFlagPlayerTarget = 0x800;

export function forcedMonsterZoneAllowedMask(state: DuelState, player: PlayerId, reason = 0, card?: DuelCardInstance, inactiveSourceUids: readonly string[] = []): number {
  let allowedMask = mainMonsterZoneMask;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== effectForceMonsterZone) continue;
    if (inactiveSourceUids.includes(effect.sourceUid)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!forceMonsterZoneEffectTargetsPlayer(effect, source, player, card)) continue;
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

function forceMonsterZoneEffectTargetsPlayer(effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId, card: DuelCardInstance | undefined): boolean {
  if (!effectHasLocationTargetRange(effect)) return continuousEffectTargetsPlayer(effect, source, player);
  if (!card) return false;
  const [selfMask = 0, opponentMask = 0] = effect.targetRange ?? [];
  const targetMask = source.controller === player ? selfMask : opponentMask;
  return locationMaskMatchesCard(card, targetMask);
}

function effectHasLocationTargetRange(effect: DuelEffectDefinition): boolean {
  if (!effect.targetRange || (effect.property ?? 0) & effectFlagPlayerTarget) return false;
  const [selfTarget = 0, opponentTarget = 0] = effect.targetRange;
  return !isPlayerSelector(selfTarget) || !isPlayerSelector(opponentTarget);
}

function isPlayerSelector(value: number): boolean {
  return value === 0 || value === 1;
}

function locationMaskMatchesCard(card: DuelCardInstance, mask: number): boolean {
  if ((mask & locationMaskFromLocation(card.location)) !== 0) return true;
  if ((mask & 0x400) !== 0 && card.location === "spellTrapZone") return true;
  if ((mask & 0x800) !== 0 && card.location === "monsterZone" && card.sequence >= 0 && card.sequence <= 4) return true;
  return (mask & 0x1000) !== 0 && card.location === "monsterZone" && card.sequence >= 5 && card.sequence <= 6;
}

function locationMaskFromLocation(location: DuelCardInstance["location"]): number {
  if (location === "deck") return 0x01;
  if (location === "hand") return 0x02;
  if (location === "monsterZone") return 0x04;
  if (location === "spellTrapZone") return 0x08;
  if (location === "graveyard") return 0x10;
  if (location === "banished") return 0x20;
  if (location === "extraDeck") return 0x40;
  if (location === "overlay") return 0x80;
  return 0;
}
