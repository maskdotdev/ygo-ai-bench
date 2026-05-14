import type { DuelAction } from "#duel/types.js";

/** Stable key for de-duplicating action references in UI maps. */
export function duelActionUiKey(action: DuelAction): string {
  return JSON.stringify(action);
}

/**
 * UIDs whose on-field / in-hand representation should surface this legal action.
 * Actions with no anchors (phase, pass, prompts) are "orphans" for a global strip.
 */
export function duelActionAnchorUids(action: DuelAction): string[] {
  switch (action.type) {
    case "normalSummon":
    case "setMonster":
    case "setSpellTrap":
    case "activateEffect":
    case "specialSummonProcedure":
    case "flipSummon":
    case "changePosition":
      return [action.uid];
    case "tributeSummon":
    case "tributeSet":
      return [action.uid, ...action.tributeUids];
    case "fusionSummon":
    case "synchroSummon":
    case "xyzSummon":
    case "linkSummon":
    case "ritualSummon":
      return [action.uid, ...action.materialUids];
    case "pendulumSummon":
      return action.summonUids;
    case "activateTrigger":
    case "declineTrigger":
      return [action.uid];
    case "declareAttack":
    case "replayAttack":
      return action.targetUid !== undefined ? [action.attackerUid, action.targetUid] : [action.attackerUid];
    case "cancelAttack":
      return [action.attackerUid];
    case "passChain":
    case "passAttack":
    case "passDamage":
    case "selectOption":
    case "selectYesNo":
    case "changePhase":
    case "endTurn":
      return [];
  }
  const exhaustive: never = action;
  return exhaustive;
}

export function isOrphanDuelAction(action: DuelAction): boolean {
  return duelActionAnchorUids(action).length === 0;
}

export function dedupeDuelActions(actions: readonly DuelAction[]): DuelAction[] {
  const out: DuelAction[] = [];
  const seen = new Set<string>();
  for (const action of actions) {
    const key = duelActionUiKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}

export function partitionDuelActionsByAnchor(actions: readonly DuelAction[]): {
  byUid: Map<string, DuelAction[]>;
  orphans: DuelAction[];
} {
  const byUid = new Map<string, DuelAction[]>();
  const orphans: DuelAction[] = [];
  for (const action of actions) {
    const uids = duelActionAnchorUids(action);
    if (uids.length === 0) {
      orphans.push(action);
      continue;
    }
    const key = duelActionUiKey(action);
    for (const uid of uids) {
      const list = byUid.get(uid) ?? [];
      if (!list.some((existing) => duelActionUiKey(existing) === key)) list.push(action);
      byUid.set(uid, list);
    }
  }
  return { byUid, orphans };
}
