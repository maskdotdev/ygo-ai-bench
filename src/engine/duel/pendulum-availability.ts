import { currentCardMatchesSetcode } from "#duel/card-code-state.js";
import type { DuelCardInstance, DuelState, ExtraPendulumSummonGrant, PlayerId } from "#duel/types.js";

export function hasPendulumSummonAvailable(state: DuelState, player: PlayerId): boolean {
  return state.players[player].pendulumSummonAvailable || extraPendulumSummons(state, player) > 0;
}

export function grantExtraPendulumSummons(state: DuelState, player: PlayerId, count = 1, grant: ExtraPendulumSummonGrant = {}): void {
  const amount = Math.max(0, Math.floor(count));
  if (amount === 0) return;
  const grants = ensureExtraPendulumSummonGrants(state, player);
  for (let index = 0; index < amount; index += 1) grants.push({ ...grant });
  state.players[player].extraPendulumSummons = grants.length;
}

export function pendulumSummonCandidatesForAvailability(state: DuelState, player: PlayerId, cards: DuelCardInstance[]): DuelCardInstance[] {
  if (state.players[player].pendulumSummonAvailable) return cards;
  return cards.filter((card) => extraPendulumSummonGrants(state, player).some((grant) => extraPendulumSummonGrantMatchesCard(state, card, grant)));
}

export function canConsumePendulumSummon(state: DuelState, player: PlayerId, cards: DuelCardInstance[]): boolean {
  if (state.players[player].pendulumSummonAvailable) return true;
  return findExtraPendulumSummonGrantIndex(state, player, cards) !== -1;
}

export function consumePendulumSummon(state: DuelState, player: PlayerId, cards: DuelCardInstance[] = []): void {
  if (state.players[player].pendulumSummonAvailable) {
    state.players[player].pendulumSummonAvailable = false;
    return;
  }
  const storedGrants = state.players[player].extraPendulumSummonGrants;
  if (!storedGrants) {
    state.players[player].extraPendulumSummons = Math.max(0, extraPendulumSummons(state, player) - 1);
    return;
  }
  const grantIndex = cards.length > 0 ? findExtraPendulumSummonGrantIndex(state, player, cards) : storedGrants.length > 0 ? 0 : -1;
  if (grantIndex !== -1) storedGrants.splice(grantIndex, 1);
  state.players[player].extraPendulumSummons = storedGrants.length;
}

function extraPendulumSummons(state: DuelState, player: PlayerId): number {
  const grants = state.players[player].extraPendulumSummonGrants;
  if (grants) return grants.length;
  return Math.max(0, Math.floor(state.players[player].extraPendulumSummons ?? 0));
}

function ensureExtraPendulumSummonGrants(state: DuelState, player: PlayerId): ExtraPendulumSummonGrant[] {
  if (state.players[player].extraPendulumSummonGrants) return state.players[player].extraPendulumSummonGrants;
  const legacyCount = Math.max(0, Math.floor(state.players[player].extraPendulumSummons ?? 0));
  state.players[player].extraPendulumSummonGrants = Array.from({ length: legacyCount }, () => ({}));
  return state.players[player].extraPendulumSummonGrants;
}

function extraPendulumSummonGrants(state: DuelState, player: PlayerId): ExtraPendulumSummonGrant[] {
  const grants = state.players[player].extraPendulumSummonGrants;
  if (grants) return grants;
  return Array.from({ length: extraPendulumSummons(state, player) }, () => ({}));
}

function findExtraPendulumSummonGrantIndex(state: DuelState, player: PlayerId, cards: DuelCardInstance[]): number {
  if (cards.length === 0) return extraPendulumSummons(state, player) > 0 ? 0 : -1;
  return extraPendulumSummonGrants(state, player).findIndex((grant) => cards.every((card) => extraPendulumSummonGrantMatchesCard(state, card, grant)));
}

function extraPendulumSummonGrantMatchesCard(state: DuelState, card: DuelCardInstance, grant: ExtraPendulumSummonGrant): boolean {
  if (grant.locationMask !== undefined && (grant.locationMask & locationMaskForPendulumSource(card)) === 0) return false;
  if (grant.setcode !== undefined && !currentCardMatchesSetcode(card, state, grant.setcode)) return false;
  return true;
}

function locationMaskForPendulumSource(card: DuelCardInstance): number {
  const location = card.location === "monsterZone" && card.previousLocation ? card.previousLocation : card.location;
  if (location === "hand") return 0x02;
  if (location === "extraDeck") return 0x40;
  return 0;
}
