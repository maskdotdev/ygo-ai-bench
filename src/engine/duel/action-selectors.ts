import { isDuelActionWindowKind } from "#duel/action-window-kinds.js";
import type { DuelAction, DuelActionWindowKind, DuelLocation, ScriptedResponseSelector } from "#duel/types.js";
import { sameStringMembers } from "#duel/string-list-match.js";

export interface DuelActionSelectorCard {
  uid: string;
  code: string;
  location: DuelLocation;
}

export function selectDuelActionBySelector(
  actions: DuelAction[],
  selector: ScriptedResponseSelector,
  cards: DuelActionSelectorCard[],
): DuelAction | undefined {
  if (selector.occurrence !== undefined && !isOccurrenceIndex(selector.occurrence)) return undefined;
  const matches = actions.filter((action) => duelActionMatchesSelector(action, selector, cards));
  return matches[selector.occurrence ?? 0];
}

export function describeDuelActionSelector(selector: ScriptedResponseSelector): string {
  return [
    `type=${selector.type}`,
    `player=${selector.player}`,
    selector.windowId !== undefined ? `windowId=${selector.windowId}` : undefined,
    selector.windowKind !== undefined ? `windowKind=${selector.windowKind}` : undefined,
    selector.windowToken !== undefined ? `windowToken=${selector.windowToken}` : undefined,
    selector.code !== undefined ? `code=${selector.code}` : undefined,
    selector.uid !== undefined ? `uid=${selector.uid}` : undefined,
    selector.summonUids ? `summonUids=${selector.summonUids.join(",")}` : undefined,
    selector.phase !== undefined ? `phase=${selector.phase}` : undefined,
    selector.attackerUid !== undefined ? `attackerUid=${selector.attackerUid}` : undefined,
    selector.targetUid !== undefined ? `targetUid=${selector.targetUid}` : undefined,
    selector.directAttack !== undefined ? `directAttack=${selector.directAttack}` : undefined,
    selector.promptId !== undefined ? `promptId=${selector.promptId}` : undefined,
    selector.effectId !== undefined ? `effectId=${selector.effectId}` : undefined,
    selector.triggerId !== undefined ? `triggerId=${selector.triggerId}` : undefined,
    selector.triggerBucket !== undefined ? `triggerBucket=${selector.triggerBucket}` : undefined,
    selector.location !== undefined ? `location=${selector.location}` : undefined,
    selector.labelIncludes !== undefined ? `labelIncludes=${selector.labelIncludes}` : undefined,
    selector.occurrence !== undefined ? `occurrence=${selector.occurrence}` : undefined,
  ].filter(Boolean).join(" ");
}

export function duelActionMatchesSelector(
  action: DuelAction,
  selector: ScriptedResponseSelector,
  cards: DuelActionSelectorCard[],
): boolean {
  if (action.type !== selector.type || action.player !== selector.player) return false;
  if (selector.windowId !== undefined && !isWindowId(selector.windowId)) return false;
  if (selector.windowId !== undefined && action.windowId !== selector.windowId) return false;
  if (selector.windowKind !== undefined && !isWindowKind(selector.windowKind)) return false;
  if (selector.windowKind !== undefined && action.windowKind !== selector.windowKind) return false;
  if (selector.windowToken !== undefined && !isWindowToken(selector.windowToken)) return false;
  if (selector.windowToken !== undefined && action.windowToken !== selector.windowToken) return false;
  if (selector.uid !== undefined && (!("uid" in action) || action.uid !== selector.uid)) return false;
  if (selector.tributeUids) {
    if ((action.type !== "tributeSummon" && action.type !== "tributeSet") || !sameStringMembers(action.tributeUids, selector.tributeUids)) return false;
  }
  if (selector.materialUids) {
    if (!isMaterialAction(action) || !sameStringMembers(action.materialUids, selector.materialUids)) return false;
  }
  if (selector.summonUids) {
    if (action.type !== "pendulumSummon" || !isPendulumSummonSelection(action.summonUids, selector.summonUids, action.maxSummons)) return false;
  }
  if (selector.position !== undefined) {
    if (action.type !== "changePosition" || action.position !== selector.position) return false;
  }
  if (selector.phase !== undefined) {
    if (action.type !== "changePhase" || action.phase !== selector.phase) return false;
  }
  if (selector.attackerUid !== undefined) {
    if ((action.type !== "declareAttack" && action.type !== "replayAttack" && action.type !== "cancelAttack") || action.attackerUid !== selector.attackerUid) return false;
  }
  if (selector.targetUid !== undefined) {
    if ((action.type !== "declareAttack" && action.type !== "replayAttack") || action.targetUid !== selector.targetUid) return false;
  }
  if (selector.directAttack !== undefined) {
    if (action.type !== "declareAttack" && action.type !== "replayAttack") return false;
    if ((action.directAttack === true) !== selector.directAttack) return false;
  }
  if (selector.promptId !== undefined) {
    if (!("promptId" in action) || action.promptId !== selector.promptId) return false;
  }
  if (selector.option !== undefined) {
    if (action.type !== "selectOption" || action.option !== selector.option) return false;
  }
  if (selector.yes !== undefined) {
    if (action.type !== "selectYesNo" || action.yes !== selector.yes) return false;
  }
  if (selector.effectId !== undefined) {
    if (!("effectId" in action) || action.effectId !== selector.effectId) return false;
  }
  if (selector.triggerId !== undefined) {
    if (!("triggerId" in action) || action.triggerId !== selector.triggerId) return false;
  }
  if (selector.triggerBucket !== undefined) {
    if (!("triggerBucket" in action) || action.triggerBucket !== selector.triggerBucket) return false;
  }
  if (selector.labelIncludes !== undefined && (selector.labelIncludes.length === 0 || !action.label.includes(selector.labelIncludes))) return false;
  if (selector.code !== undefined || selector.location !== undefined) {
    if (!("uid" in action)) return false;
    const card = cards.find((candidate) => candidate.uid === action.uid);
    if (!card) return false;
    if (selector.code !== undefined && card.code !== selector.code) return false;
    if (selector.location !== undefined && card.location !== selector.location) return false;
  }
  return true;
}

function isMaterialAction(action: DuelAction): action is Extract<DuelAction, { materialUids: string[] }> {
  return action.type === "fusionSummon" || action.type === "synchroSummon" || action.type === "xyzSummon" || action.type === "linkSummon" || action.type === "ritualSummon";
}

function isPendulumSummonSelection(candidates: string[], selected: string[], maxSummons: number): boolean {
  if (!selected.length || selected.length > candidates.length || selected.length > maxSummons) return false;
  if (new Set(selected).size !== selected.length) return false;
  return selected.every((uid) => candidates.includes(uid));
}

function isWindowId(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isWindowKind(value: DuelActionWindowKind): boolean {
  return isDuelActionWindowKind(value);
}

function isWindowToken(value: string): boolean {
  return value.length > 0;
}

function isOccurrenceIndex(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
