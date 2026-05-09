import { findCard } from "#duel/card-state.js";
import type { DuelCardCounterBuckets, DuelCardInstance, DuelLocation, DuelState, PlayerId } from "#duel/types.js";

export type DuelCounterBucket = "permanent" | "resetWhileNegated";

export function getDuelCardCounter(card: DuelCardInstance | undefined, counterType: number): number {
  const buckets = getCounterBuckets(card, counterType);
  return buckets.permanent + buckets.resetWhileNegated;
}

export function canAddDuelCardCounter(card: DuelCardInstance | undefined, count: number): boolean {
  return Boolean(card && count > 0 && card.location !== "deck" && card.location !== "extraDeck" && card.location !== "overlay");
}

export function addDuelCardCounter(card: DuelCardInstance | undefined, counterType: number, count: number, bucket: DuelCounterBucket = "resetWhileNegated"): boolean {
  const amount = Math.max(0, Math.floor(count));
  if (!canAddDuelCardCounter(card, amount) || !card) return false;
  const buckets = getCounterBuckets(card, counterType);
  buckets[bucket] += amount;
  writeCounterBuckets(card, counterType, buckets);
  return true;
}

export function removeDuelCardCounter(card: DuelCardInstance | undefined, counterType: number, count: number): boolean {
  const amount = Math.max(0, Math.floor(count));
  if (!card || amount <= 0 || getDuelCardCounter(card, counterType) < amount) return false;
  const buckets = getCounterBuckets(card, counterType);
  const resetRemoved = Math.min(amount, buckets.resetWhileNegated);
  buckets.resetWhileNegated -= resetRemoved;
  buckets.permanent -= amount - resetRemoved;
  writeCounterBuckets(card, counterType, buckets);
  return true;
}

export function getAllDuelCardCounters(card: DuelCardInstance | undefined): Record<number, number> {
  const counters: Record<number, number> = {};
  const keys = new Set([...Object.keys(card?.counters ?? {}), ...Object.keys(card?.counterBuckets ?? {})]);
  for (const key of keys) {
    const normalized = getDuelCardCounter(card, Number(key));
    if (normalized > 0) counters[Number(key)] = normalized;
  }
  return counters;
}

export function removeAllDuelCardCounters(card: DuelCardInstance | undefined): number {
  if (!card?.counters && !card?.counterBuckets) return 0;
  const total = Object.values(getAllDuelCardCounters(card)).reduce((sum, count) => sum + count, 0);
  if (total > 0) {
    delete card.counters;
    delete card.counterBuckets;
  }
  return total;
}

export function removeDuelCardResetWhileNegatedCounters(card: DuelCardInstance | undefined): number {
  if (!card?.counters && !card?.counterBuckets) return 0;
  let removed = 0;
  for (const key of new Set([...Object.keys(card.counters ?? {}), ...Object.keys(card.counterBuckets ?? {})])) {
    const counterType = Number(key);
    const buckets = getCounterBuckets(card, counterType);
    removed += buckets.resetWhileNegated;
    buckets.resetWhileNegated = 0;
    writeCounterBuckets(card, counterType, buckets);
  }
  return removed;
}

export function canRemoveDuelCounters(state: DuelState, player: PlayerId, selfLocations: DuelLocation[], opponentLocations: DuelLocation[], counterType: number, count: number): boolean {
  return availableCounterCards(state, player, selfLocations, opponentLocations, counterType).reduce((total, card) => total + getDuelCardCounter(card, counterType), 0) >= Math.max(0, count);
}

export function removeDuelCounters(state: DuelState, player: PlayerId, selfLocations: DuelLocation[], opponentLocations: DuelLocation[], counterType: number, count: number): string[] {
  let remaining = Math.max(0, Math.floor(count));
  if (remaining <= 0 || !canRemoveDuelCounters(state, player, selfLocations, opponentLocations, counterType, remaining)) return [];
  const removed: string[] = [];
  for (const card of availableCounterCards(state, player, selfLocations, opponentLocations, counterType)) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, getDuelCardCounter(card, counterType));
    if (removeDuelCardCounter(findCard(state, card.uid), counterType, amount)) {
      removed.push(card.uid);
      remaining -= amount;
    }
  }
  return remaining === 0 ? removed : [];
}

function availableCounterCards(state: DuelState, player: PlayerId, selfLocations: DuelLocation[], opponentLocations: DuelLocation[], counterType: number): DuelCardInstance[] {
  return state.cards
    .filter((card) => isCounterLocationIncluded(card, player, selfLocations, opponentLocations))
    .filter((card) => getDuelCardCounter(card, counterType) > 0)
    .sort((left, right) => left.controller - right.controller || left.location.localeCompare(right.location) || left.sequence - right.sequence);
}

function isCounterLocationIncluded(card: DuelCardInstance, player: PlayerId, selfLocations: DuelLocation[], opponentLocations: DuelLocation[]): boolean {
  if (card.controller === player) return selfLocations.includes(card.location);
  return opponentLocations.includes(card.location);
}

function getCounterBuckets(card: DuelCardInstance | undefined, counterType: number): Required<DuelCardCounterBuckets> {
  const stored = card?.counterBuckets?.[counterType];
  if (stored) {
    return {
      permanent: normalizeCounterAmount(stored.permanent),
      resetWhileNegated: normalizeCounterAmount(stored.resetWhileNegated),
    };
  }
  return {
    permanent: 0,
    resetWhileNegated: normalizeCounterAmount(card?.counters?.[counterType]),
  };
}

function writeCounterBuckets(card: DuelCardInstance, counterType: number, buckets: Required<DuelCardCounterBuckets>): void {
  const permanent = normalizeCounterAmount(buckets.permanent);
  const resetWhileNegated = normalizeCounterAmount(buckets.resetWhileNegated);
  const total = permanent + resetWhileNegated;

  card.counters = { ...(card.counters ?? {}) };
  card.counterBuckets = { ...(card.counterBuckets ?? {}) };
  if (total > 0) {
    card.counters[counterType] = total;
    card.counterBuckets[counterType] = {
      ...(permanent > 0 ? { permanent } : {}),
      ...(resetWhileNegated > 0 ? { resetWhileNegated } : {}),
    };
    return;
  }

  delete card.counters[counterType];
  delete card.counterBuckets[counterType];
  if (Object.keys(card.counters).length === 0) delete card.counters;
  if (Object.keys(card.counterBuckets).length === 0) delete card.counterBuckets;
}

function normalizeCounterAmount(value: number | undefined): number {
  return Math.max(0, Math.floor(value ?? 0));
}
