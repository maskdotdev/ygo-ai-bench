import type { DuelEventName } from "#duel/types.js";

export function triggerEventFromCode(code: number | undefined): DuelEventName | undefined {
  if (code === 34) return undefined;
  if (code === 1001) return "flipSummoned";
  if (code === 1100) return "normalSummoned";
  if (code === 1102) return "specialSummoned";
  if (code === 1029) return "destroyed";
  if (code === 1014) return "sentToGraveyard";
  if (code === 1015 || code === 1019) return "leftField";
  if (code === 1016) return "positionChanged";
  if (code === 1040) return "adjust";
  if (code === 1130) return "attackDeclared";
  if (code === 1142) return "attackDisabled";
  if (code === 1139) return "battleDestroyed";
  if (code === 1140) return "battleDestroyed";
  return undefined;
}
