import { hasZoneSpace } from "#duel/card-state.js";
import { firstOpenFieldZoneSequence } from "#duel/disabled-field-zones.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

export type MonsterZoneSequenceSnapshot = Array<{ uid: string; sequence: number }>;

export function hasOpenMonsterZone(session: DuelSession, player: PlayerId, zoneMask: number | undefined): boolean {
  return firstOpenMonsterSequence(session, player, zoneMask) !== undefined;
}

export function applyMonsterZoneMask(session: DuelSession, card: DuelCardInstance, player: PlayerId, zoneMask: number | undefined): void {
  const sequence = firstOpenMonsterSequence(session, player, zoneMask, card.uid);
  if (sequence !== undefined) card.sequence = sequence;
}

export function monsterZoneSequenceSnapshot(session: DuelSession, player: PlayerId, movingUid: string): MonsterZoneSequenceSnapshot {
  return session.state.cards
    .filter((card) => card.controller === player && card.location === "monsterZone" && card.uid !== movingUid)
    .map((card) => ({ uid: card.uid, sequence: card.sequence }));
}

export function restoreMonsterZoneSequenceSnapshot(session: DuelSession, snapshot: MonsterZoneSequenceSnapshot): void {
  for (const { uid, sequence } of snapshot) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid && candidate.location === "monsterZone");
    if (card) card.sequence = sequence;
  }
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
