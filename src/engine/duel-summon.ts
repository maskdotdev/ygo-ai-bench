import { findCard, getCards, hasZoneSpace, moveDuelCard, pushDuelLog, requireControlledCard, requireZoneSpace } from "./duel-card-state.js";
import type { DuelAction, DuelCardInstance, DuelEventName, DuelState, PlayerId } from "./duel-types.js";

export type DuelEventCollector = (eventName: DuelEventName, eventCard?: DuelCardInstance) => void;

export function normalSummon(state: DuelState, player: PlayerId, uid: string, collectEvent: DuelEventCollector): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (tributeCountForNormalSummon(card) > 0) throw new Error(`${card.name} requires a Tribute Summon`);
  if (!state.players[player].normalSummonAvailable) throw new Error("Normal Summon is not available");
  requireZoneSpace(state, player, "monsterZone");
  moveDuelCard(state, uid, "monsterZone", player);
  card.position = "faceUpAttack";
  state.players[player].normalSummonAvailable = false;
  pushDuelLog(state, "normalSummon", player, card.name, "Normal Summoned from hand");
  collectEvent("normalSummoned", card);
}

export function setMonster(state: DuelState, player: PlayerId, uid: string): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (!state.players[player].normalSummonAvailable) throw new Error("Normal Summon is not available");
  requireZoneSpace(state, player, "monsterZone");
  moveDuelCard(state, uid, "monsterZone", player);
  card.position = "faceDownDefense";
  card.faceUp = false;
  state.players[player].normalSummonAvailable = false;
  pushDuelLog(state, "setMonster", player, card.name, "Set from hand");
}

export function tributeSummonDuelCard(state: DuelState, player: PlayerId, uid: string, tributeUids: string[], collectEvent: DuelEventCollector): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "monster") throw new Error(`${card.name} is not a monster`);
  if (!state.players[player].normalSummonAvailable) throw new Error("Normal Summon is not available");
  const requiredTributes = tributeCountForNormalSummon(card);
  if (requiredTributes <= 0) throw new Error(`${card.name} does not require tributes`);
  if (tributeUids.length !== requiredTributes) throw new Error(`${card.name} requires ${requiredTributes} tribute(s)`);

  const uniqueTributes = [...new Set(tributeUids)];
  if (uniqueTributes.length !== tributeUids.length) throw new Error("Tributes must be unique");
  for (const tributeUid of uniqueTributes) requireControlledCard(state, player, tributeUid, "monsterZone");
  for (const tributeUid of uniqueTributes) {
    const tribute = moveDuelCard(state, tributeUid, "graveyard", player);
    pushDuelLog(state, "release", player, tribute.name, `Tributed for ${card.name}`);
    collectEvent("sentToGraveyard", tribute);
  }

  moveDuelCard(state, uid, "monsterZone", player);
  card.position = "faceUpAttack";
  card.faceUp = true;
  state.players[player].normalSummonAvailable = false;
  pushDuelLog(state, "tributeSummon", player, card.name, `Tribute Summoned with ${requiredTributes} tribute(s)`);
  collectEvent("normalSummoned", card);
}

export function flipSummonDuelCard(state: DuelState, player: PlayerId, uid: string, collectEvent: DuelEventCollector): DuelCardInstance {
  const card = requireControlledCard(state, player, uid, "monsterZone");
  if (card.position !== "faceDownDefense") throw new Error(`${card.name} is not face-down defense`);
  card.position = "faceUpAttack";
  card.faceUp = true;
  pushDuelLog(state, "flipSummon", player, card.name, "Flip Summoned");
  collectEvent("flipSummoned", card);
  return card;
}

export function normalSummonActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[]): DuelAction[] {
  if (!state.players[player].normalSummonAvailable || !hasZoneSpace(state, player, "monsterZone")) return [];
  const actions: DuelAction[] = [];
  for (const card of hand.filter((candidate) => candidate.kind === "monster")) {
    if (tributeCountForNormalSummon(card) === 0) actions.push({ type: "normalSummon", player, uid: card.uid, label: `Normal Summon ${card.name}` });
    actions.push({ type: "setMonster", player, uid: card.uid, label: `Set ${card.name}` });
  }
  return actions;
}

export function tributeSummonActions(state: DuelState, player: PlayerId, hand: DuelCardInstance[]): DuelAction[] {
  if (!state.players[player].normalSummonAvailable) return [];
  const availableTributes = getCards(state, player, "monsterZone").filter((card) => isMonsterLike(card));
  const actions: DuelAction[] = [];
  for (const card of hand.filter((candidate) => candidate.kind === "monster")) {
    const tributeCount = tributeCountForNormalSummon(card);
    if (tributeCount <= 0 || availableTributes.length < tributeCount) continue;
    for (const tributeUids of tributeCombinations(availableTributes, tributeCount)) {
      const tributeNames = tributeUids.map((tributeUid) => findCard(state, tributeUid)?.name ?? tributeUid).join(", ");
      actions.push({ type: "tributeSummon", player, uid: card.uid, tributeUids, label: `Tribute Summon ${card.name} using ${tributeNames}` });
    }
  }
  return actions;
}

export function flipSummonActions(state: DuelState, player: PlayerId): DuelAction[] {
  return getCards(state, player, "monsterZone")
    .filter((card) => card.position === "faceDownDefense")
    .map((card) => ({ type: "flipSummon", player, uid: card.uid, label: `Flip Summon ${card.name}` }));
}

function tributeCountForNormalSummon(card: DuelCardInstance): number {
  const level = card.data.level ?? 4;
  if (level >= 7) return 2;
  if (level >= 5) return 1;
  return 0;
}

function tributeCombinations(cards: DuelCardInstance[], count: number): string[][] {
  if (count === 0) return [[]];
  if (cards.length < count) return [];
  if (count === 1) return cards.map((card) => [card.uid]);
  const results: string[][] = [];
  for (let index = 0; index <= cards.length - count; index += 1) {
    const head = cards[index];
    if (!head) continue;
    for (const tail of tributeCombinations(cards.slice(index + 1), count - 1)) {
      results.push([head.uid, ...tail]);
    }
  }
  return results;
}

function isMonsterLike(card: DuelCardInstance): boolean {
  return card.kind === "monster" || card.kind === "extra";
}
