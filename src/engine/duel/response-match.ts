import type { DuelAction, DuelActionWindowKind, DuelResponse } from "#duel/types.js";

const duelActionWindowKinds = new Set<DuelActionWindowKind>(["prompt", "chainResponse", "triggerBucket", "battle", "open"]);

export function sameAction(a: DuelAction, b: unknown): b is DuelResponse {
  if (!isRecord(b) || typeof b.type !== "string") return false;
  const response = b as DuelResponse;
  if (a.type !== response.type || a.player !== response.player) return false;
  if (hasMalformedWindowStamp(response) || hasPartialWindowStamp(response)) return false;
  if (hasWindowId(a) && hasWindowId(response) && a.windowId !== response.windowId) return false;
  if (hasWindowKind(a) && hasWindowKind(response) && a.windowKind !== response.windowKind) return false;
  if ("uid" in a && (!("uid" in response) || a.uid !== response.uid)) return false;
  if (a.type === "activateEffect" && response.type === "activateEffect" && a.effectId !== response.effectId) return false;
  if (a.type === "specialSummonProcedure" && response.type === "specialSummonProcedure" && a.effectId !== response.effectId) return false;
  if (a.type === "activateTrigger" && response.type === "activateTrigger" && (a.triggerId !== response.triggerId || a.triggerBucket !== response.triggerBucket)) return false;
  if (a.type === "declineTrigger" && response.type === "declineTrigger" && (a.triggerId !== response.triggerId || a.triggerBucket !== response.triggerBucket)) return false;
  if (a.type === "selectOption" && response.type === "selectOption" && (a.promptId !== response.promptId || a.option !== response.option)) return false;
  if (a.type === "selectYesNo" && response.type === "selectYesNo" && (a.promptId !== response.promptId || a.yes !== response.yes)) return false;
  if (a.type === "tributeSummon" && response.type === "tributeSummon" && !sameStringSet(a.tributeUids, response.tributeUids)) return false;
  if (a.type === "fusionSummon" && response.type === "fusionSummon" && !sameStringSet(a.materialUids, response.materialUids)) return false;
  if (a.type === "synchroSummon" && response.type === "synchroSummon" && !sameStringSet(a.materialUids, response.materialUids)) return false;
  if (a.type === "xyzSummon" && response.type === "xyzSummon" && !sameStringSet(a.materialUids, response.materialUids)) return false;
  if (a.type === "linkSummon" && response.type === "linkSummon" && !sameStringSet(a.materialUids, response.materialUids)) return false;
  if (a.type === "ritualSummon" && response.type === "ritualSummon" && !sameStringSet(a.materialUids, response.materialUids)) return false;
  if (a.type === "changePosition" && response.type === "changePosition" && a.position !== response.position) return false;
  if (a.type === "declareAttack" && response.type === "declareAttack" && a.attackerUid !== response.attackerUid) return false;
  if (a.type === "declareAttack" && response.type === "declareAttack" && a.targetUid !== response.targetUid) return false;
  if (a.type === "replayAttack" && response.type === "replayAttack" && a.attackerUid !== response.attackerUid) return false;
  if (a.type === "replayAttack" && response.type === "replayAttack" && a.targetUid !== response.targetUid) return false;
  if (a.type === "cancelAttack" && response.type === "cancelAttack" && a.attackerUid !== response.attackerUid) return false;
  if (a.type === "changePhase" && response.type === "changePhase" && a.phase !== response.phase) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasWindowId(value: unknown): value is { windowId: number } {
  return isRecord(value) && "windowId" in value && typeof value.windowId === "number";
}

function hasWindowKind(value: unknown): value is { windowKind: DuelActionWindowKind } {
  return isRecord(value) && "windowKind" in value && typeof value.windowKind === "string" && duelActionWindowKinds.has(value.windowKind as DuelActionWindowKind);
}

function hasPartialWindowStamp(value: unknown): boolean {
  return hasWindowIdKey(value) !== hasWindowKindKey(value);
}

function hasMalformedWindowStamp(value: unknown): boolean {
  return (hasWindowIdKey(value) && !hasWindowId(value)) || (hasWindowKindKey(value) && !hasWindowKind(value));
}

function hasWindowIdKey(value: unknown): boolean {
  return isRecord(value) && "windowId" in value;
}

function hasWindowKindKey(value: unknown): boolean {
  return isRecord(value) && "windowKind" in value;
}

function sameStringSet(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}
