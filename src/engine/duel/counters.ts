import { findCard } from "#duel/card-state.js";
import type { DuelCardInstance, DuelLocation, DuelState, PlayerId } from "#duel/types.js";

export function getDuelCardCounter(card: DuelCardInstance | undefined, counterType: number): number {
  return Math.max(0, Math.floor(card?.counters?.[counterType] ?? 0));
}

export function canAddDuelCardCounter(card: DuelCardInstance | undefined, count: number): boolean {
  return Boolean(card && count > 0 && card.location !== "deck" && card.location !== "extraDeck" && card.location !== "overlay");
}

export function addDuelCardCounter(card: DuelCardInstance | undefined, counterType: number, count: number): boolean {
  const amount = Math.max(0, Math.floor(count));
  if (!canAddDuelCardCounter(card, amount) || !card) return false;
  card.counters = { ...(card.counters ?? {}), [counterType]: getDuelCardCounter(card, counterType) + amount };
  return true;
}

export function removeDuelCardCounter(card: DuelCardInstance | undefined, counterType: number, count: number): boolean {
  const amount = Math.max(0, Math.floor(count));
  if (!card || amount <= 0 || getDuelCardCounter(card, counterType) < amount) return false;
  const remaining = getDuelCardCounter(card, counterType) - amount;
  card.counters = { ...(card.counters ?? {}) };
  if (remaining > 0) card.counters[counterType] = remaining;
  else delete card.counters[counterType];
  if (Object.keys(card.counters).length === 0) delete card.counters;
  return true;
}

export function getAllDuelCardCounters(card: DuelCardInstance | undefined): Record<number, number> {
  const counters: Record<number, number> = {};
  for (const [counterType, count] of Object.entries(card?.counters ?? {})) {
    const normalized = Math.max(0, Math.floor(count));
    if (normalized > 0) counters[Number(counterType)] = normalized;
  }
  return counters;
}

export function removeAllDuelCardCounters(card: DuelCardInstance | undefined): number {
  if (!card?.counters) return 0;
  const total = Object.values(getAllDuelCardCounters(card)).reduce((sum, count) => sum + count, 0);
  if (total > 0) delete card.counters;
  return total;
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
