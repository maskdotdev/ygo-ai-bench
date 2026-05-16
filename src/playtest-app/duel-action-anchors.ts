import { copyDuelAction } from "#duel/action-copy.js";
import type { DuelAction, PendingTriggerBucketState, TriggerOrderPromptState } from "#duel/types.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";

export interface DuelActionUiGroup {
  key: string;
  label: string;
  selectionKind?: DuelActionUiSelectionKind;
  promptId?: string;
  promptType?: "selectOption" | "selectYesNo";
  windowId?: number;
  windowKind?: DuelLegalActionGroup["windowKind"];
  windowToken?: string;
  triggerBucket?: PendingTriggerBucketState;
  triggerOrderPrompt?: TriggerOrderPromptState;
  actions: DuelAction[];
}

export type DuelActionUiSelectionKind = "attackTarget" | "battleReplay" | "material" | "pendulum" | "tribute";

/** Stable key for de-duplicating action references in UI maps. */
export function duelActionUiKey(action: DuelAction): string {
  return JSON.stringify(action);
}

export function copyDuelLegalActionGroup(group: DuelLegalActionGroup): DuelLegalActionGroup {
  return {
    ...group,
    ...(group.triggerBucket === undefined ? {} : { triggerBucket: { ...group.triggerBucket, triggerIds: [...group.triggerBucket.triggerIds] } }),
    ...(group.triggerOrderPrompt === undefined ? {} : { triggerOrderPrompt: { ...group.triggerOrderPrompt, triggerIds: [...group.triggerOrderPrompt.triggerIds] } }),
    actions: group.actions.map(copyDuelAction),
  };
}

export function copyDuelActionUiGroup(group: DuelActionUiGroup): DuelActionUiGroup {
  return {
    ...group,
    ...(group.triggerBucket === undefined ? {} : { triggerBucket: { ...group.triggerBucket, triggerIds: [...group.triggerBucket.triggerIds] } }),
    ...(group.triggerOrderPrompt === undefined ? {} : { triggerOrderPrompt: { ...group.triggerOrderPrompt, triggerIds: [...group.triggerOrderPrompt.triggerIds] } }),
    actions: group.actions.map(copyDuelAction),
  };
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

export function orphanDuelActionGroups(
  actions: readonly DuelAction[],
  groups: readonly DuelLegalActionGroup[] | undefined,
  interactiveUids: ReadonlySet<string>,
): DuelActionUiGroup[] {
  const partitioned = partitionDuelActionsByAnchor(actions);
  const orphanKeys = new Set(partitioned.orphans.map(duelActionUiKey));
  for (const action of actions) {
    const anchors = duelActionAnchorUids(action);
    if (anchors.length > 0 && !anchors.some((uid) => interactiveUids.has(uid))) orphanKeys.add(duelActionUiKey(action));
  }
  const sourceGroups = groups?.length
    ? groups
    : [{ key: "ungrouped", label: "Other", actions: [...actions] }];
  return sourceGroups
    .map((group) => {
      const groupActions = dedupeDuelActions(group.actions.filter((action) => orphanKeys.has(duelActionUiKey(action))));
      return {
        key: group.key,
        label: group.label,
        ...selectionKindState({ actions: groupActions, windowKind: group.windowKind }),
        ...(group.promptId === undefined ? {} : { promptId: group.promptId }),
        ...(group.promptType === undefined ? {} : { promptType: group.promptType }),
        ...(group.windowId === undefined ? {} : { windowId: group.windowId }),
        ...(group.windowKind === undefined ? {} : { windowKind: group.windowKind }),
        ...(group.windowToken === undefined ? {} : { windowToken: group.windowToken }),
        ...(group.triggerBucket === undefined ? {} : { triggerBucket: { ...group.triggerBucket, triggerIds: [...group.triggerBucket.triggerIds] } }),
        ...(group.triggerOrderPrompt === undefined ? {} : { triggerOrderPrompt: { ...group.triggerOrderPrompt, triggerIds: [...group.triggerOrderPrompt.triggerIds] } }),
        actions: groupActions.map(copyDuelAction),
      };
    })
    .filter((group) => group.actions.length > 0);
}

function selectionKindState(group: Pick<DuelActionUiGroup, "actions" | "windowKind">): { selectionKind: DuelActionUiSelectionKind } | Record<string, never> {
  const selectionKind = duelActionUiGroupSelectionKind(group);
  return selectionKind === undefined ? {} : { selectionKind };
}

export function duelActionUiGroupSelectionKind(group: Pick<DuelActionUiGroup, "actions" | "windowKind">): DuelActionUiSelectionKind | undefined {
  if (group.actions.some((action) => action.type === "fusionSummon" || action.type === "synchroSummon" || action.type === "xyzSummon" || action.type === "linkSummon" || action.type === "ritualSummon")) return "material";
  if (group.actions.some((action) => action.type === "pendulumSummon")) return "pendulum";
  if (group.actions.some((action) => action.type === "tributeSummon" || action.type === "tributeSet")) return "tribute";
  if (group.windowKind !== "battle") return undefined;
  if (group.actions.some((action) => action.type === "replayAttack" || action.type === "cancelAttack")) return "battleReplay";
  if (group.actions.some((action) => action.type === "declareAttack")) return "attackTarget";
  return undefined;
}

export function duelActionUiGroupLabel(group: Pick<DuelActionUiGroup, "label" | "windowKind" | "actions">): string {
  if (group.actions.some((action) => action.type === "fusionSummon" || action.type === "synchroSummon" || action.type === "xyzSummon" || action.type === "linkSummon" || action.type === "ritualSummon")) {
    return "Material Selection";
  }
  if (group.actions.some((action) => action.type === "pendulumSummon")) return "Pendulum Selection";
  if (group.actions.some((action) => action.type === "tributeSummon" || action.type === "tributeSet")) return "Tribute Selection";
  if (group.windowKind !== "battle") return group.label;
  if (group.actions.some((action) => action.type === "replayAttack" || action.type === "cancelAttack")) return "Replay Choice";
  if (group.actions.some((action) => action.type === "passDamage")) return "Damage Step Response";
  if (group.actions.some((action) => action.type === "passAttack")) return "Attack Response";
  return group.label;
}
