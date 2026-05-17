import { hasZoneSpace } from "#duel/card-state.js";
import { firstOpenFieldZoneSequence } from "#duel/disabled-field-zones.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

export function hasOpenMonsterZone(session: DuelSession, player: PlayerId, zoneMask: number | undefined): boolean {
  return firstOpenMonsterSequence(session, player, zoneMask) !== undefined;
}

export function applyMonsterZoneMask(session: DuelSession, card: DuelCardInstance, player: PlayerId, zoneMask: number | undefined): void {
  const sequence = firstOpenMonsterSequence(session, player, zoneMask, card.uid);
  if (sequence !== undefined) card.sequence = sequence;
}

function firstOpenMonsterSequence(session: DuelSession, player: PlayerId, zoneMask: number | undefined, movingUid?: string): number | undefined {
  if (zoneMask === undefined || zoneMask === 0) {
    if (!hasZoneSpace(session.state, player, "monsterZone") && !movingUid) return undefined;
    return nextOpenMonsterSequence(session, player, movingUid);
  }
  return firstOpenFieldZoneSequence(session.state, player, "monsterZone", movingUid === undefined ? [] : [movingUid], zoneMask);
}

function nextOpenMonsterSequence(session: DuelSession, player: PlayerId, movingUid?: string): number | undefined {
  return firstOpenFieldZoneSequence(session.state, player, "monsterZone", movingUid === undefined ? [] : [movingUid]);
}
