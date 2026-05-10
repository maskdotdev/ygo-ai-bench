import type { DuelAction, DuelActionWindowKind, DuelResponse } from "#duel/types.js";
import { sameStringMembers } from "#duel/string-list-match.js";

const duelActionWindowKinds = new Set<DuelActionWindowKind>(["prompt", "chainResponse", "triggerBucket", "battle", "open"]);

export function sameAction(a: DuelAction, b: unknown): b is DuelResponse {
  if (!isRecord(b) || typeof b.type !== "string") return false;
  const response = b as DuelResponse;
  if (a.type !== response.type || a.player !== response.player) return false;
  if (hasMalformedWindowStamp(response) || hasPartialWindowStamp(response)) return false;
  if (requiresWindowStampEcho(a) && !hasWindowStamp(response)) return false;
  if (hasWindowId(a) && hasWindowId(response) && a.windowId !== response.windowId) return false;
  if (hasWindowKind(a) && hasWindowKind(response) && a.windowKind !== response.windowKind) return false;
  if (hasWindowToken(a) && hasWindowToken(response) && a.windowToken !== response.windowToken) return false;
  if ("uid" in a && (!("uid" in response) || a.uid !== response.uid)) return false;
  if (a.type === "activateEffect" && response.type === "activateEffect" && a.effectId !== response.effectId) return false;
  if (a.type === "specialSummonProcedure" && response.type === "specialSummonProcedure" && a.effectId !== response.effectId) return false;
  if (
    a.type === "activateTrigger" &&
    response.type === "activateTrigger" &&
    (a.triggerId !== response.triggerId || a.triggerBucket !== response.triggerBucket || a.effectId !== response.effectId)
  ) return false;
  if (
    a.type === "declineTrigger" &&
    response.type === "declineTrigger" &&
    (a.triggerId !== response.triggerId || a.triggerBucket !== response.triggerBucket || a.effectId !== response.effectId)
  ) return false;
  if (a.type === "selectOption" && response.type === "selectOption" && (a.promptId !== response.promptId || a.option !== response.option)) return false;
  if (a.type === "selectYesNo" && response.type === "selectYesNo" && (a.promptId !== response.promptId || a.yes !== response.yes)) return false;
  if (a.type === "tributeSummon" && response.type === "tributeSummon" && (a.effectId !== response.effectId || !sameStringMembers(a.tributeUids, response.tributeUids))) return false;
  if (a.type === "tributeSet" && response.type === "tributeSet" && !sameStringMembers(a.tributeUids, response.tributeUids)) return false;
  if (a.type === "fusionSummon" && response.type === "fusionSummon" && !sameStringMembers(a.materialUids, response.materialUids)) return false;
  if (a.type === "synchroSummon" && response.type === "synchroSummon" && !sameStringMembers(a.materialUids, response.materialUids)) return false;
  if (a.type === "xyzSummon" && response.type === "xyzSummon" && !sameStringMembers(a.materialUids, response.materialUids)) return false;
  if (a.type === "linkSummon" && response.type === "linkSummon" && !sameStringMembers(a.materialUids, response.materialUids)) return false;
  if (a.type === "ritualSummon" && response.type === "ritualSummon" && !sameStringMembers(a.materialUids, response.materialUids)) return false;
  if (a.type === "pendulumSummon" && response.type === "pendulumSummon" && !isPendulumSummonSelection(a.summonUids, response.summonUids, a.maxSummons)) return false;
  if (a.type === "changePosition" && response.type === "changePosition" && a.position !== response.position) return false;
  if (a.type === "declareAttack" && response.type === "declareAttack" && a.attackerUid !== response.attackerUid) return false;
  if (a.type === "declareAttack" && response.type === "declareAttack" && a.targetUid !== response.targetUid) return false;
  if (a.type === "declareAttack" && response.type === "declareAttack" && !sameDirectAttackIntent(a, response)) return false;
  if (a.type === "replayAttack" && response.type === "replayAttack" && a.attackerUid !== response.attackerUid) return false;
  if (a.type === "replayAttack" && response.type === "replayAttack" && a.targetUid !== response.targetUid) return false;
  if (a.type === "replayAttack" && response.type === "replayAttack" && !sameDirectAttackIntent(a, response)) return false;
  if (a.type === "cancelAttack" && response.type === "cancelAttack" && a.attackerUid !== response.attackerUid) return false;
  if (a.type === "changePhase" && response.type === "changePhase" && a.phase !== response.phase) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sameDirectAttackIntent(action: Extract<DuelAction, { type: "declareAttack" | "replayAttack" }>, response: Extract<DuelResponse, { type: "declareAttack" | "replayAttack" }>): boolean {
  if (action.directAttack === true) return response.directAttack === true;
  return response.directAttack !== true;
}

function isPendulumSummonSelection(candidates: string[], selected: string[], maxSummons: number): boolean {
  if (!selected.length || selected.length > candidates.length || selected.length > maxSummons) return false;
  if (new Set(selected).size !== selected.length) return false;
  return selected.every((uid) => candidates.includes(uid));
}

function hasWindowId(value: unknown): value is { windowId: number } {
  return isRecord(value) && "windowId" in value && typeof value.windowId === "number";
}

function hasWindowKind(value: unknown): value is { windowKind: DuelActionWindowKind } {
  return isRecord(value) && "windowKind" in value && typeof value.windowKind === "string" && duelActionWindowKinds.has(value.windowKind as DuelActionWindowKind);
}

function hasWindowToken(value: unknown): value is { windowToken: string } {
  return isRecord(value) && "windowToken" in value && typeof value.windowToken === "string";
}

function hasPartialWindowStamp(value: unknown): boolean {
  const hasWindowId = hasWindowIdKey(value);
  const hasWindowKind = hasWindowKindKey(value);
  const hasWindowToken = hasWindowTokenKey(value);
  const hasAnyWindowStamp = hasWindowId || hasWindowKind || hasWindowToken;
  return hasAnyWindowStamp && !(hasWindowId && hasWindowKind && hasWindowToken);
}

function hasWindowStamp(value: unknown): boolean {
  return hasWindowId(value) && hasWindowKind(value) && hasWindowToken(value);
}

function requiresWindowStampEcho(action: DuelAction): boolean {
  return (
    action.type === "replayAttack" ||
    action.type === "cancelAttack" ||
    action.type === "selectOption" ||
    action.type === "selectYesNo" ||
    action.type === "activateTrigger" ||
    action.type === "declineTrigger" ||
    action.type === "passAttack" ||
    action.type === "passDamage" ||
    action.type === "passChain" ||
    action.type === "activateEffect" ||
    action.type === "specialSummonProcedure" ||
    action.type === "normalSummon" ||
    action.type === "tributeSummon" ||
    action.type === "tributeSet" ||
    action.type === "fusionSummon" ||
    action.type === "synchroSummon" ||
    action.type === "xyzSummon" ||
    action.type === "linkSummon" ||
    action.type === "ritualSummon" ||
    action.type === "pendulumSummon" ||
    action.type === "setMonster" ||
    action.type === "setSpellTrap" ||
    action.type === "flipSummon" ||
    action.type === "changePosition" ||
    action.type === "declareAttack" ||
    action.type === "changePhase" ||
    action.type === "endTurn"
  ) && hasWindowStamp(action);
}

function hasMalformedWindowStamp(value: unknown): boolean {
  return (hasWindowIdKey(value) && !hasWindowId(value)) || (hasWindowKindKey(value) && !hasWindowKind(value)) || (hasWindowTokenKey(value) && !hasWindowToken(value));
}

function hasWindowIdKey(value: unknown): boolean {
  return isRecord(value) && "windowId" in value;
}

function hasWindowKindKey(value: unknown): boolean {
  return isRecord(value) && "windowKind" in value;
}

function hasWindowTokenKey(value: unknown): boolean {
  return isRecord(value) && "windowToken" in value;
}
