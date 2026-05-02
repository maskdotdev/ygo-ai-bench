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

export function movementSnapshot(card: DuelCardInstance): LuaMoveSnapshot {
  return { controller: card.controller, location: card.location, sequence: card.sequence };
}

export function didMove(card: DuelCardInstance, before: LuaMoveSnapshot): boolean {
  return card.controller !== before.controller || card.location !== before.location || card.sequence !== before.sequence;
}
