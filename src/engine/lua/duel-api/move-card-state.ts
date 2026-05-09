import type { CardPosition, DuelCardInstance } from "#duel/types.js";

export type LuaMoveSnapshot = Pick<DuelCardInstance, "controller" | "location" | "sequence">;

export function applyLuaMovePosition(card: { position: CardPosition; faceUp: boolean }, position: CardPosition): void {
  card.position = position;
  card.faceUp = position !== "faceDownDefense";
}

export function faceupAttackOrFacedownDefensePosition(card: DuelCardInstance): CardPosition | undefined {
  if (card.position === "faceUpAttack") return "faceDownDefense";
  if (card.position === "faceDownDefense") return "faceUpAttack";
  if (card.position === "faceUpDefense") return "faceUpAttack";
  return undefined;
}

export function changeSpellTrapPosition(card: DuelCardInstance, requestedPosition: CardPosition, positionMask: number | undefined): boolean {
  if (card.location !== "spellTrapZone" || (card.kind !== "spell" && card.kind !== "trap")) return false;
  if (requestedPosition !== "faceDownDefense" && requestedPosition !== "faceDown") return false;
  if (positionMask !== undefined && (positionMask & 0x0a) === 0) return false;
  if (!card.faceUp && card.position === "faceDown") return false;
  card.previousLocation = card.location;
  card.previousController = card.controller;
  card.previousSequence = card.sequence;
  card.previousPosition = card.position;
  card.previousFaceUp = card.faceUp;
  card.position = "faceDown";
  card.faceUp = false;
  return true;
}

export function movementSnapshot(card: DuelCardInstance): LuaMoveSnapshot {
  return { controller: card.controller, location: card.location, sequence: card.sequence };
}

export function didMove(card: DuelCardInstance, before: LuaMoveSnapshot): boolean {
  return card.controller !== before.controller || card.location !== before.location || card.sequence !== before.sequence;
}
