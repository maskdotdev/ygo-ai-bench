import type { DuelEffectDefinition, DuelState, PlayerId } from "#duel/types.js";

export type FieldZoneLocation = "monsterZone" | "spellTrapZone";

const effectDisableField = 260;
const effectFlagSetAvailable = 0x100;
const fieldZoneCount = 5;

export function disabledFieldZoneMask(state: DuelState, player: PlayerId, location: FieldZoneLocation): number {
  let mask = 0;
  for (const effect of state.effects) {
    if (!isActiveDisableFieldEffect(state, effect)) continue;
    const shift = disableFieldShift(effect.controller, player, location);
    mask |= ((effect.value ?? 0) >>> shift) & 0x1f;
  }
  return mask;
}

export function isFieldZoneDisabled(state: DuelState, player: PlayerId, location: FieldZoneLocation, sequence: number): boolean {
  if (sequence < 0 || sequence >= fieldZoneCount) return false;
  return (disabledFieldZoneMask(state, player, location) & (1 << sequence)) !== 0;
}

export function availableFieldZoneCount(state: DuelState, player: PlayerId, location: FieldZoneLocation, excludedUids: readonly string[] = [], zoneMask = 0): number {
  let count = 0;
  for (let sequence = 0; sequence < fieldZoneCount; sequence += 1) {
    if (zoneMask !== 0 && (zoneMask & (1 << sequence)) === 0) continue;
    if (isFieldZoneDisabled(state, player, location, sequence)) continue;
    if (state.cards.some((card) => card.controller === player && card.location === location && card.sequence === sequence && !excludedUids.includes(card.uid))) continue;
    count += 1;
  }
  return count;
}

export function firstOpenFieldZoneSequence(state: DuelState, player: PlayerId, location: FieldZoneLocation, excludedUids: readonly string[] = [], zoneMask = 0): number | undefined {
  for (let sequence = 0; sequence < fieldZoneCount; sequence += 1) {
    if (zoneMask !== 0 && (zoneMask & (1 << sequence)) === 0) continue;
    if (isFieldZoneDisabled(state, player, location, sequence)) continue;
    if (state.cards.some((card) => card.controller === player && card.location === location && card.sequence === sequence && !excludedUids.includes(card.uid))) continue;
    return sequence;
  }
  return undefined;
}

function isActiveDisableFieldEffect(state: DuelState, effect: DuelEffectDefinition): boolean {
  if (effect.event !== "continuous" || effect.code !== effectDisableField || effect.value === undefined) return false;
  const source = state.cards.find((card) => card.uid === effect.sourceUid);
  if (!source || !effect.range.includes(source.location)) return false;
  if ((source.location === "monsterZone" || source.location === "spellTrapZone") && !source.faceUp && ((effect.property ?? 0) & effectFlagSetAvailable) === 0) return false;
  return true;
}

function disableFieldShift(controller: PlayerId, player: PlayerId, location: FieldZoneLocation): number {
  if (location === "monsterZone") return controller === player ? 0 : 16;
  return controller === player ? 8 : 24;
}
