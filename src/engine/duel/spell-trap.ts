import { moveDuelCard, pushDuelLog, requireControlledCard, requireZoneSpace } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelState, PlayerId } from "#duel/types.js";
import type { DuelEventCollector } from "#duel/summon.js";

export function setSpellTrap(state: DuelState, player: PlayerId, uid: string, collectEvent?: DuelEventCollector): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "spell" && card.kind !== "trap") throw new Error(`${card.name} is not a spell/trap`);
  const targetLocation = isFieldSpell(card) ? "fieldZone" : "spellTrapZone";
  requireZoneSpace(state, player, targetLocation);
  if (targetLocation === "fieldZone") sendExistingFieldSpellToGraveyard(state, player, uid);
  moveDuelCard(state, uid, targetLocation, player, duelReason.rule);
  card.position = "faceDown";
  card.faceUp = false;
  pushDuelLog(state, "set", player, card.name, "Set from hand");
  collectEvent?.("spellTrapSet", card);
}

function isFieldSpell(card: { kind: string; data: { typeFlags?: number } }): boolean {
  return card.kind === "spell" && ((card.data.typeFlags ?? 0) & 0x80000) !== 0;
}

function sendExistingFieldSpellToGraveyard(state: DuelState, player: PlayerId, incomingUid: string): void {
  const existing = state.cards.find((card) => card.controller === player && card.location === "fieldZone" && card.uid !== incomingUid);
  if (existing) moveDuelCard(state, existing.uid, "graveyard", player, duelReason.rule, player);
}
