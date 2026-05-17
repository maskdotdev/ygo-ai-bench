import { findCard, pushDuelLog } from "#duel/card-state.js";
import { cardTypeFlags, currentCardHasEffect, currentLeftScale, currentLevel, currentRightScale } from "#duel/card-stats.js";
import { availableFieldZoneCount } from "#duel/disabled-field-zones.js";
import { pendulumAnyLevelScaleEffectCode, pendulumLevelBypassEffectCode } from "#duel/pendulum-effect-codes.js";
import { canConsumePendulumSummon, consumePendulumSummon, hasPendulumSummonAvailable, pendulumSummonCandidatesForAvailability, pendulumSummonCandidatesForGrant, pendulumSummonExtraGrants } from "#duel/pendulum-availability.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { maxSimultaneousSpecialSummonCount } from "#duel/special-summon-count.js";
import type { DuelAction, DuelCardInstance, DuelState, ExtraPendulumSummonGrant, PlayerId } from "#duel/types.js";

type PendulumSummonAction = Extract<DuelAction, { type: "pendulumSummon" }>;
interface PendulumScaleInfo {
  anyLevelCandidateAllowed: boolean;
  highScale: number;
  lowScale: number;
}

export function pendulumSummonActions(state: DuelState, player: PlayerId, canSummon: (uid: string) => boolean): PendulumSummonAction[] {
  if (!hasPendulumSummonAvailable(state, player)) return [];
  const zoneCount = maxSimultaneousSpecialSummonCount(state, player, availableFieldZoneCount(state, player, "monsterZone"));
  if (zoneCount <= 0) return [];
  const actions: PendulumSummonAction[] = [];
  const seenCandidateSets = new Set<string>();
  const pushActionCandidates = (candidates: DuelCardInstance[], maxSummons: number) => {
    const summonUids = candidates.map((card) => card.uid);
    if (!summonUids.length) return;
    const candidateKey = `${maxSummons}:${summonUids.join("|")}`;
    if (seenCandidateSets.has(candidateKey)) return;
    seenCandidateSets.add(candidateKey);
    const summonNames = summonUids.map((uid) => findCard(state, uid)?.name ?? uid).join(", ");
    actions.push({ type: "pendulumSummon", player, summonUids, maxSummons, label: `Pendulum Summon ${summonNames}` });
  };
  const pushAction = (scalePlayer: PlayerId, grant?: ExtraPendulumSummonGrant) => {
    const scales = pendulumScales(state, scalePlayer);
    if (!scales) return;
    const candidates = pendulumSummonCandidates(state, player, scales, canSummon);
    const regularCandidates = grant ? pendulumSummonCandidatesForGrant(state, candidates.regular, grant) : pendulumSummonCandidatesForAvailability(state, player, candidates.regular);
    const anyLevelCandidates = grant ? pendulumSummonCandidatesForGrant(state, candidates.anyLevel, grant) : pendulumSummonCandidatesForAvailability(state, player, candidates.anyLevel);
    pushActionCandidates(regularCandidates, zoneCount);
    pushActionCandidates(anyLevelCandidates, Math.min(zoneCount, 1));
  };
  if (state.players[player].pendulumSummonAvailable) pushAction(player);
  for (const grant of pendulumSummonExtraGrants(state, player)) {
    pushAction(grant.scalePlayer ?? player, grant);
    for (const alternative of grant.scaleAlternatives ?? []) {
      const { scaleAlternatives, ...baseGrant } = grant;
      pushAction(alternative.scalePlayer, { ...baseGrant, ...(alternative.locationMask === undefined ? {} : { locationMask: alternative.locationMask }) });
    }
  }
  return actions;
}

export function pendulumSummonDuelCards(
  state: DuelState,
  player: PlayerId,
  summonUids: string[],
  canSummon: (uid: string) => boolean,
  specialSummon: (uid: string, player: PlayerId) => DuelCardInstance,
): DuelCardInstance[] {
  const legalAction = pendulumSummonActions(state, player, canSummon).find((action) => isPendulumSummonSelection(action.summonUids, summonUids, action.maxSummons));
  if (!legalAction) throw new Error("Pendulum Summon is not legal");
  const selectedCards = summonUids.map((uid) => findCard(state, uid)).filter((card): card is DuelCardInstance => Boolean(card));
  if (!canConsumePendulumSummon(state, player, selectedCards)) throw new Error("Pendulum Summon is not legal");
  const summoned: DuelCardInstance[] = [];
  for (const uid of summonUids) {
    const card = specialSummon(uid, player);
    card.summonType = "pendulum";
    markProcedureComplete(card);
    summoned.push(card);
  }
  consumePendulumSummon(state, player, selectedCards);
  pushDuelLog(state, "pendulumSummon", player, undefined, `Pendulum Summoned ${summoned.length} monster(s)`);
  return summoned;
}

function isPendulumSummonSelection(candidates: string[], selected: string[], maxSummons: number): boolean {
  if (!selected.length || selected.length > candidates.length || selected.length > maxSummons) return false;
  if (new Set(selected).size !== selected.length) return false;
  return selected.every((uid) => candidates.includes(uid));
}

function pendulumSummonCandidates(
  state: DuelState,
  player: PlayerId,
  scales: PendulumScaleInfo,
  canSummon: (uid: string) => boolean,
): { anyLevel: DuelCardInstance[]; regular: DuelCardInstance[] } {
  const regular: DuelCardInstance[] = [];
  const anyLevel: DuelCardInstance[] = [];
  for (const card of state.cards) {
    const candidateKind = pendulumSummonCandidateKind(state, player, card, scales, canSummon);
    if (candidateKind === "regular") regular.push(card);
    else if (candidateKind === "anyLevel") anyLevel.push(card);
  }
  return {
    anyLevel: anyLevel.sort(comparePendulumCandidateLocation),
    regular: regular.sort(comparePendulumCandidateLocation),
  };
}

function pendulumSummonCandidateKind(
  state: DuelState,
  player: PlayerId,
  card: DuelCardInstance,
  scales: PendulumScaleInfo,
  canSummon: (uid: string) => boolean,
): "anyLevel" | "regular" | undefined {
  if (!canBasicPendulumSummonCandidate(state, player, card, canSummon)) return undefined;
  const level = currentLevel(card, state);
  if (level > scales.lowScale && level < scales.highScale || currentCardHasEffect(card, state, pendulumLevelBypassEffectCode)) return "regular";
  return scales.anyLevelCandidateAllowed ? "anyLevel" : undefined;
}

function canBasicPendulumSummonCandidate(state: DuelState, player: PlayerId, card: DuelCardInstance, canSummon: (uid: string) => boolean): boolean {
  if (card.controller !== player || !isPendulumMonster(state, card)) return false;
  if (card.location !== "hand" && !(card.location === "extraDeck" && card.faceUp)) return false;
  return canSummon(card.uid);
}

function pendulumScales(state: DuelState, player: PlayerId): PendulumScaleInfo | undefined {
  const left = pendulumZoneCard(state, player, 0);
  const right = pendulumZoneCard(state, player, 1);
  if (!left || !right) return undefined;
  const low = Math.min(pendulumScale(state, left), pendulumScale(state, right));
  const high = Math.max(pendulumScale(state, left), pendulumScale(state, right));
  return low < high ? { anyLevelCandidateAllowed: currentCardHasEffect(left, state, pendulumAnyLevelScaleEffectCode) && currentCardHasEffect(right, state, pendulumAnyLevelScaleEffectCode), highScale: high, lowScale: low } : undefined;
}

function pendulumZoneCard(state: DuelState, player: PlayerId, sequence: number): DuelCardInstance | undefined {
  return state.cards.find((card) => card.controller === player && card.location === "spellTrapZone" && card.sequence === sequence && isPendulumCard(state, card));
}

function pendulumScale(state: DuelState, card: DuelCardInstance): number {
  return card.data.leftScale === undefined ? currentRightScale(card, state) : currentLeftScale(card, state);
}

function isPendulumMonster(state: DuelState, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, state) & 0x1000001) === 0x1000001;
}

function isPendulumCard(state: DuelState, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, state) & 0x1000000) !== 0;
}

function comparePendulumCandidateLocation(a: DuelCardInstance, b: DuelCardInstance): number {
  return locationSort(a.location) - locationSort(b.location) || a.sequence - b.sequence;
}

function locationSort(location: DuelCardInstance["location"]): number {
  if (location === "hand") return 0;
  if (location === "extraDeck") return 1;
  return 2;
}
