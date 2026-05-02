import type { DuelAction, DuelResponse } from "#duel/types.js";

export function sameAction(a: DuelAction, b: DuelResponse): boolean {
  if (a.type !== b.type || a.player !== b.player) return false;
  if (hasWindowId(a) && hasWindowId(b) && a.windowId !== b.windowId) return false;
  if ("uid" in a && "uid" in b && a.uid !== b.uid) return false;
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

function sameStringSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}
