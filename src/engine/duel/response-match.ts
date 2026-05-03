import type { DuelAction, DuelResponse } from "#duel/types.js";

export function sameAction(a: DuelAction, b: DuelResponse): boolean {
  if (a.type !== b.type || a.player !== b.player) return false;
  if (hasMalformedWindowStamp(b) || hasPartialWindowStamp(b)) return false;
  if (hasWindowId(a) && hasWindowId(b) && a.windowId !== b.windowId) return false;
  if (hasWindowKind(a) && hasWindowKind(b) && a.windowKind !== b.windowKind) return false;
  if ("uid" in a && (!("uid" in b) || a.uid !== b.uid)) return false;
  if (a.type === "activateEffect" && b.type === "activateEffect" && a.effectId !== b.effectId) return false;
  if (a.type === "specialSummonProcedure" && b.type === "specialSummonProcedure" && a.effectId !== b.effectId) return false;
  if (a.type === "activateTrigger" && b.type === "activateTrigger" && a.triggerId !== b.triggerId) return false;
  if (a.type === "declineTrigger" && b.type === "declineTrigger" && a.triggerId !== b.triggerId) return false;
  if (a.type === "selectOption" && b.type === "selectOption" && (a.promptId !== b.promptId || a.option !== b.option)) return false;
  if (a.type === "selectYesNo" && b.type === "selectYesNo" && (a.promptId !== b.promptId || a.yes !== b.yes)) return false;
  if (a.type === "tributeSummon" && b.type === "tributeSummon" && !sameStringSet(a.tributeUids, b.tributeUids)) return false;
  if (a.type === "fusionSummon" && b.type === "fusionSummon" && !sameStringSet(a.materialUids, b.materialUids)) return false;
  if (a.type === "synchroSummon" && b.type === "synchroSummon" && !sameStringSet(a.materialUids, b.materialUids)) return false;
  if (a.type === "xyzSummon" && b.type === "xyzSummon" && !sameStringSet(a.materialUids, b.materialUids)) return false;
  if (a.type === "linkSummon" && b.type === "linkSummon" && !sameStringSet(a.materialUids, b.materialUids)) return false;
  if (a.type === "ritualSummon" && b.type === "ritualSummon" && !sameStringSet(a.materialUids, b.materialUids)) return false;
  if (a.type === "changePosition" && b.type === "changePosition" && a.position !== b.position) return false;
  if (a.type === "declareAttack" && b.type === "declareAttack" && a.attackerUid !== b.attackerUid) return false;
  if (a.type === "declareAttack" && b.type === "declareAttack" && a.targetUid !== b.targetUid) return false;
  if (a.type === "replayAttack" && b.type === "replayAttack" && a.attackerUid !== b.attackerUid) return false;
  if (a.type === "replayAttack" && b.type === "replayAttack" && a.targetUid !== b.targetUid) return false;
  if (a.type === "cancelAttack" && b.type === "cancelAttack" && a.attackerUid !== b.attackerUid) return false;
  if (a.type === "changePhase" && b.type === "changePhase" && a.phase !== b.phase) return false;
  return true;
}

function hasWindowId(value: DuelAction | DuelResponse): value is (DuelAction | DuelResponse) & { windowId: number } {
  return "windowId" in value && typeof value.windowId === "number";
}

function hasWindowKind(value: DuelAction | DuelResponse): value is (DuelAction | DuelResponse) & { windowKind: string } {
  return "windowKind" in value && typeof value.windowKind === "string";
}

function hasPartialWindowStamp(value: DuelResponse): boolean {
  return hasWindowIdKey(value) !== hasWindowKindKey(value);
}

function hasMalformedWindowStamp(value: DuelResponse): boolean {
  return (hasWindowIdKey(value) && !hasWindowId(value)) || (hasWindowKindKey(value) && !hasWindowKind(value));
}

function hasWindowIdKey(value: DuelResponse): boolean {
  return "windowId" in value;
}

function hasWindowKindKey(value: DuelResponse): boolean {
  return "windowKind" in value;
}

function sameStringSet(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a.length === b.length && a.every((value) => b.includes(value));
}
