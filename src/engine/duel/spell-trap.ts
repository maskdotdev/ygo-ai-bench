import { moveDuelCard, pushDuelLog, requireControlledCard, requireZoneSpace } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelState, PlayerId } from "#duel/types.js";

export function setSpellTrap(state: DuelState, player: PlayerId, uid: string): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "spell" && card.kind !== "trap") throw new Error(`${card.name} is not a spell/trap`);
  requireZoneSpace(state, player, "spellTrapZone");
  moveDuelCard(state, uid, "spellTrapZone", player, duelReason.rule);
  card.position = "faceDown";
  card.faceUp = false;
  pushDuelLog(state, "set", player, card.name, "Set from hand");
}
