import { hasZoneSpace } from "#duel/card-state.js";
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
  const occupied = new Set(
    session.state.cards
      .filter((card) => card.controller === player && card.location === "monsterZone" && card.uid !== movingUid)
      .map((card) => card.sequence),
  );
  for (let sequence = 0; sequence < 5; sequence += 1) {
    if ((zoneMask & (1 << sequence)) !== 0 && !occupied.has(sequence)) return sequence;
  }
  return undefined;
}

function nextOpenMonsterSequence(session: DuelSession, player: PlayerId, movingUid?: string): number | undefined {
  const occupied = new Set(
    session.state.cards
      .filter((card) => card.controller === player && card.location === "monsterZone" && card.uid !== movingUid)
      .map((card) => card.sequence),
  );
  for (let sequence = 0; sequence < 5; sequence += 1) {
    if (!occupied.has(sequence)) return sequence;
  }
  return undefined;
}
