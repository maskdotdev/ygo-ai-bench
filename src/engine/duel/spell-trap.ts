import { firstOpenFieldZoneSequence } from "#duel/disabled-field-zones.js";
import { moveDuelCard, pushDuelLog, requireControlledCard, requireZoneSpace } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelState, PlayerId } from "#duel/types.js";
import type { DuelEventCollector } from "#duel/summon.js";

export function setSpellTrap(state: DuelState, player: PlayerId, uid: string, collectEvent?: DuelEventCollector, spellTrapSequence?: number): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "spell" && card.kind !== "trap") throw new Error(`${card.name} is not a spell/trap`);
  const targetLocation = isFieldSpell(card) ? "fieldZone" : "spellTrapZone";
  requireZoneSpace(state, player, targetLocation);
  if (targetLocation === "fieldZone") sendExistingFieldSpellToGraveyard(state, player, uid);
  const sequence = targetLocation === "spellTrapZone" ? requireSpellTrapZoneSequence(state, player, spellTrapSequence) : undefined;
  moveDuelCard(state, uid, targetLocation, player, duelReason.rule);
  if (sequence !== undefined) card.sequence = sequence;
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

function requireSpellTrapZoneSequence(state: DuelState, player: PlayerId, requestedSequence?: number): number | undefined {
  if (requestedSequence === undefined) return undefined;
  if (!Number.isSafeInteger(requestedSequence) || requestedSequence < 0 || requestedSequence > 4) throw new Error(`Invalid Spell & Trap Zone ${requestedSequence}`);
  const sequence = firstOpenFieldZoneSequence(state, player, "spellTrapZone", [], 1 << requestedSequence);
  if (sequence === undefined) throw new Error(`Spell & Trap Zone ${requestedSequence + 1} is not available`);
  return sequence;
}
