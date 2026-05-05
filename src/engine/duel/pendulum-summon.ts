import { isDuelMonsterLike } from "#duel/card-predicates.js";
import { findCard, getCards, pushDuelLog } from "#duel/card-state.js";
import type { DuelAction, DuelCardInstance, DuelState, PlayerId } from "#duel/types.js";

type PendulumSummonAction = Extract<DuelAction, { type: "pendulumSummon" }>;

export function pendulumSummonActions(state: DuelState, player: PlayerId, canSummon: (uid: string) => boolean): PendulumSummonAction[] {
  const zoneCount = 5 - getCards(state, player, "monsterZone").length;
  const scales = pendulumScales(state, player);
  if (zoneCount <= 0 || !scales) return [];
  const [lowScale, highScale] = scales;
  const summonUids = pendulumSummonCandidates(state, player, lowScale, highScale, canSummon).slice(0, zoneCount).map((card) => card.uid);
  if (!summonUids.length) return [];
  const summonNames = summonUids.map((uid) => findCard(state, uid)?.name ?? uid).join(", ");
  return [{ type: "pendulumSummon", player, summonUids, label: `Pendulum Summon ${summonNames}` }];
}

export function pendulumSummonDuelCards(
  state: DuelState,
  player: PlayerId,
  summonUids: string[],
  canSummon: (uid: string) => boolean,
  specialSummon: (uid: string, player: PlayerId) => DuelCardInstance,
): DuelCardInstance[] {
  const legalAction = pendulumSummonActions(state, player, canSummon).find((action) => isPendulumSummonSelection(action.summonUids, summonUids));
  if (!legalAction) throw new Error("Pendulum Summon is not legal");
  const summoned: DuelCardInstance[] = [];
  for (const uid of summonUids) {
    const card = specialSummon(uid, player);
    card.summonType = "pendulum";
    summoned.push(card);
  }
  pushDuelLog(state, "pendulumSummon", player, undefined, `Pendulum Summoned ${summoned.length} monster(s)`);
  return summoned;
}

function isPendulumSummonSelection(candidates: string[], selected: string[]): boolean {
  if (!selected.length || selected.length > candidates.length) return false;
  if (new Set(selected).size !== selected.length) return false;
  return selected.every((uid) => candidates.includes(uid));
}

function pendulumSummonCandidates(
  state: DuelState,
  player: PlayerId,
  lowScale: number,
  highScale: number,
  canSummon: (uid: string) => boolean,
): DuelCardInstance[] {
  return state.cards
    .filter((card) => canPendulumSummonCard(player, card, lowScale, highScale, canSummon))
    .sort((a, b) => locationSort(a.location) - locationSort(b.location) || a.sequence - b.sequence);
}

function canPendulumSummonCard(player: PlayerId, card: DuelCardInstance, lowScale: number, highScale: number, canSummon: (uid: string) => boolean): boolean {
  if (card.controller !== player || !isPendulumMonster(card)) return false;
  if (card.location !== "hand" && !(card.location === "extraDeck" && card.faceUp)) return false;
  const level = card.data.level ?? 0;
  return level > lowScale && level < highScale && canSummon(card.uid);
}

function pendulumScales(state: DuelState, player: PlayerId): [number, number] | undefined {
  const left = pendulumZoneCard(state, player, 0);
  const right = pendulumZoneCard(state, player, 1);
  if (!left || !right) return undefined;
  const low = Math.min(pendulumScale(left), pendulumScale(right));
  const high = Math.max(pendulumScale(left), pendulumScale(right));
  return low < high ? [low, high] : undefined;
}

function pendulumZoneCard(state: DuelState, player: PlayerId, sequence: number): DuelCardInstance | undefined {
  return state.cards.find((card) => card.controller === player && card.location === "spellTrapZone" && card.sequence === sequence && isPendulumCard(card));
}

function pendulumScale(card: DuelCardInstance): number {
  return card.data.leftScale ?? card.data.rightScale ?? 0;
}

function isPendulumMonster(card: DuelCardInstance): boolean {
  return isDuelMonsterLike(card) && isPendulumCard(card);
}

function isPendulumCard(card: DuelCardInstance): boolean {
  return ((card.data.typeFlags ?? 0) & 0x1000000) !== 0;
}

function locationSort(location: DuelCardInstance["location"]): number {
  if (location === "hand") return 0;
  if (location === "extraDeck") return 1;
  return 2;
}
