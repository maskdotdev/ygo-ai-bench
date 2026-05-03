import type { DuelAction, DuelLocation, ScriptedResponseSelector } from "#duel/types.js";

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
  const matches = actions.filter((action) => duelActionMatchesSelector(action, selector, cards));
  return matches[selector.occurrence ?? 0];
}

export function describeDuelActionSelector(selector: ScriptedResponseSelector): string {
  return [
    `type=${selector.type}`,
    `player=${selector.player}`,
    selector.windowId !== undefined ? `windowId=${selector.windowId}` : undefined,
    selector.windowKind ? `windowKind=${selector.windowKind}` : undefined,
    selector.code ? `code=${selector.code}` : undefined,
    selector.uid ? `uid=${selector.uid}` : undefined,
    selector.phase ? `phase=${selector.phase}` : undefined,
    selector.attackerUid ? `attackerUid=${selector.attackerUid}` : undefined,
    selector.targetUid ? `targetUid=${selector.targetUid}` : undefined,
    selector.promptId ? `promptId=${selector.promptId}` : undefined,
    selector.effectId ? `effectId=${selector.effectId}` : undefined,
    selector.triggerId ? `triggerId=${selector.triggerId}` : undefined,
    selector.triggerBucket ? `triggerBucket=${selector.triggerBucket}` : undefined,
    selector.location ? `location=${selector.location}` : undefined,
    selector.labelIncludes ? `labelIncludes=${selector.labelIncludes}` : undefined,
  ].filter(Boolean).join(" ");
}

export function duelActionMatchesSelector(
  action: DuelAction,
  selector: ScriptedResponseSelector,
  cards: DuelActionSelectorCard[],
): boolean {
  if (action.type !== selector.type || action.player !== selector.player) return false;
  if (selector.windowId !== undefined && action.windowId !== selector.windowId) return false;
  if (selector.windowKind !== undefined && action.windowKind !== selector.windowKind) return false;
  if (selector.uid && "uid" in action && action.uid !== selector.uid) return false;
  if (selector.tributeUids) {
    if (action.type !== "tributeSummon" || !sameStringSet(action.tributeUids, selector.tributeUids)) return false;
  }
  if (selector.materialUids) {
    if (!isMaterialAction(action) || !sameStringSet(action.materialUids, selector.materialUids)) return false;
  }
  if (selector.position) {
    if (action.type !== "changePosition" || action.position !== selector.position) return false;
  }
  if (selector.phase) {
    if (action.type !== "changePhase" || action.phase !== selector.phase) return false;
  }
  if (selector.attackerUid) {
    if ((action.type !== "declareAttack" && action.type !== "replayAttack" && action.type !== "cancelAttack") || action.attackerUid !== selector.attackerUid) return false;
  }
  if (selector.targetUid) {
    if ((action.type !== "declareAttack" && action.type !== "replayAttack") || action.targetUid !== selector.targetUid) return false;
  }
  if (selector.directAttack !== undefined) {
    if (action.type !== "declareAttack" && action.type !== "replayAttack") return false;
    if ((action.targetUid === undefined) !== selector.directAttack) return false;
  }
  if (selector.promptId) {
    if (!("promptId" in action) || action.promptId !== selector.promptId) return false;
  }
  if (selector.option !== undefined) {
    if (action.type !== "selectOption" || action.option !== selector.option) return false;
  }
  if (selector.yes !== undefined) {
    if (action.type !== "selectYesNo" || action.yes !== selector.yes) return false;
  }
  if (selector.effectId) {
    if (!("effectId" in action) || action.effectId !== selector.effectId) return false;
  }
  if (selector.triggerId) {
    if (!("triggerId" in action) || action.triggerId !== selector.triggerId) return false;
  }
  if (selector.triggerBucket) {
    if (!("triggerBucket" in action) || action.triggerBucket !== selector.triggerBucket) return false;
  }
  if (selector.labelIncludes && !action.label.includes(selector.labelIncludes)) return false;
  if (selector.code || selector.location) {
    if (!("uid" in action)) return false;
    const card = cards.find((candidate) => candidate.uid === action.uid);
    if (!card) return false;
    if (selector.code && card.code !== selector.code) return false;
    if (selector.location && card.location !== selector.location) return false;
  }
  return true;
}

function isMaterialAction(action: DuelAction): action is Extract<DuelAction, { materialUids: string[] }> {
  return action.type === "fusionSummon" || action.type === "synchroSummon" || action.type === "xyzSummon" || action.type === "linkSummon" || action.type === "ritualSummon";
}

function sameStringSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}
