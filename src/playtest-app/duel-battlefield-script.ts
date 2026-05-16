import {
  applyResponse,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  queryPublicState,
} from "#duel/core.js";
import type { DuelAction, DuelActionWindowKind, DuelPhase, DuelSession, PlayerId, PublicDuelState, TriggerBucket } from "#duel/types.js";
import { duelActionAnchorUids, duelActionUiGroupLabel, type DuelActionUiGroup } from "./duel-action-anchors.js";
import { duelBattlefieldActionView, visibleDuelBattlefieldActions } from "./duel-battlefield-actions.js";
import { duelPromptView, type DuelPromptView } from "./duel-prompt-view.js";

export interface DuelBattlefieldActionSelector {
  player: PlayerId;
  type: DuelAction["type"];
  uid?: string;
  windowId?: number;
  windowKind?: DuelActionWindowKind;
  windowToken?: string;
  phase?: DuelPhase;
  tributeUids?: readonly string[];
  materialUids?: readonly string[];
  summonUids?: readonly string[];
  attackerUid?: string;
  targetUid?: string;
  directAttack?: boolean;
  promptId?: string;
  option?: number;
  yes?: boolean;
  effectId?: string;
  triggerId?: string;
  triggerBucket?: TriggerBucket;
  labelIncludes?: string;
  groupLabel?: string;
  occurrence?: number;
}

export interface DuelBattlefieldScriptResult {
  ok: boolean;
  state: PublicDuelState;
  failedStep?: number;
  failure?: string;
  visibleActions: DuelAction[];
  visibleGroups: DuelActionUiGroup[];
  prompt?: DuelPromptView;
}

export interface DuelBattlefieldScriptStepResult extends DuelBattlefieldScriptResult {
  nextStep: number;
  done: boolean;
  appliedAction?: DuelAction;
}

export function runDuelBattlefieldScript(
  session: DuelSession,
  steps: readonly DuelBattlefieldActionSelector[],
): DuelBattlefieldScriptResult {
  for (let index = 0; index < steps.length; index += 1) {
    const selector = steps[index]!;
    const view = battlefieldScriptView(session, selector.player);
    const action = selectVisibleBattlefieldAction(selector, view.visibleActions, view.visibleGroups);
    if (!action) {
      return battlefieldScriptResult(session, selector.player, index, `No visible battlefield action matched ${describeBattlefieldSelector(selector)}`);
    }
    const result = applyResponse(session, action);
    if (!result.ok) {
      return battlefieldScriptResult(session, selector.player, index, result.error ?? `Rejected ${describeBattlefieldSelector(selector)}`);
    }
  }
  const lastPlayer = steps[steps.length - 1]?.player ?? 0;
  return battlefieldScriptResult(session, lastPlayer);
}

export function runDuelBattlefieldScriptStep(
  session: DuelSession,
  steps: readonly DuelBattlefieldActionSelector[],
  step: number,
): DuelBattlefieldScriptStepResult {
  if (!Number.isInteger(step) || step < 0) {
    return {
      ...battlefieldScriptResult(session, 0, 0, `Invalid script step ${step}`),
      nextStep: 0,
      done: true,
    };
  }
  if (step >= steps.length) {
    const lastPlayer = steps[steps.length - 1]?.player ?? 0;
    return {
      ...battlefieldScriptResult(session, lastPlayer),
      nextStep: steps.length,
      done: true,
    };
  }

  const selector = steps[step]!;
  const view = battlefieldScriptView(session, selector.player);
  const action = selectVisibleBattlefieldAction(selector, view.visibleActions, view.visibleGroups);
  if (!action) {
    return {
      ...battlefieldScriptResult(session, selector.player, step, `No visible battlefield action matched ${describeBattlefieldSelector(selector)}`),
      nextStep: step,
      done: true,
    };
  }
  const result = applyResponse(session, action);
  if (!result.ok) {
    return {
      ...battlefieldScriptResult(session, selector.player, step, result.error ?? `Rejected ${describeBattlefieldSelector(selector)}`),
      nextStep: step,
      done: true,
    };
  }

  const nextStep = step + 1;
  return {
    ...battlefieldScriptResult(session, selector.player),
    nextStep,
    done: nextStep >= steps.length,
    appliedAction: { ...action },
  };
}

function battlefieldScriptResult(
  session: DuelSession,
  player: PlayerId,
  failedStep?: number,
  failure?: string,
): DuelBattlefieldScriptResult {
  const state = queryPublicState(session);
  const view = battlefieldScriptView(session, player);
  const visibleGroups = view.visibleGroups.map((group) => ({
    ...group,
    label: duelActionUiGroupLabel(group),
    actions: group.actions.map((action) => ({ ...action })),
  }));
  const prompt = duelPromptView(state.prompt, visibleGroups);
  return {
    ok: failedStep === undefined,
    state,
    ...(failedStep === undefined ? {} : { failedStep }),
    ...(failure === undefined ? {} : { failure }),
    visibleActions: view.visibleActions.map((action) => ({ ...action })),
    visibleGroups,
    ...(prompt === undefined ? {} : { prompt }),
  };
}

function battlefieldScriptView(session: DuelSession, player: PlayerId): { visibleActions: DuelAction[]; visibleGroups: DuelActionUiGroup[] } {
  const state = queryPublicState(session);
  const view = duelBattlefieldActionView(
    state,
    player,
    getDuelLegalActions(session, player),
    getGroupedDuelLegalActions(session, player),
  );
  return {
    visibleActions: visibleDuelBattlefieldActions(view),
    visibleGroups: view.orphanGroups,
  };
}

function selectVisibleBattlefieldAction(
  selector: DuelBattlefieldActionSelector,
  visibleActions: readonly DuelAction[],
  visibleGroups: readonly DuelActionUiGroup[],
): DuelAction | undefined {
  const groupKeys = new Set(
    selector.groupLabel === undefined
      ? []
      : visibleGroups
        .filter((group) => duelActionUiGroupLabel(group) === selector.groupLabel)
        .flatMap((group) => group.actions.map((action) => JSON.stringify(action))),
  );
  const matches = visibleActions.filter((action) => {
    if (action.type !== selector.type) return false;
    if (selector.windowId !== undefined && action.windowId !== selector.windowId) return false;
    if (selector.windowKind !== undefined && action.windowKind !== selector.windowKind) return false;
    if (selector.windowToken !== undefined && action.windowToken !== selector.windowToken) return false;
    if (selector.uid !== undefined && !duelActionAnchorUids(action).includes(selector.uid)) return false;
    if (selector.phase !== undefined && (action.type !== "changePhase" || action.phase !== selector.phase)) return false;
    if (selector.tributeUids !== undefined) {
      if ((action.type !== "tributeSummon" && action.type !== "tributeSet") || !sameStringMembers(action.tributeUids, selector.tributeUids)) return false;
    }
    if (selector.materialUids !== undefined) {
      if (!isMaterialSelectionAction(action) || !sameStringMembers(action.materialUids, selector.materialUids)) return false;
    }
    if (selector.summonUids !== undefined) {
      if (action.type !== "pendulumSummon" || !sameStringMembers(action.summonUids, selector.summonUids)) return false;
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
    if (selector.promptId !== undefined && (!("promptId" in action) || action.promptId !== selector.promptId)) return false;
    if (selector.option !== undefined && (action.type !== "selectOption" || action.option !== selector.option)) return false;
    if (selector.yes !== undefined && (action.type !== "selectYesNo" || action.yes !== selector.yes)) return false;
    if (selector.effectId !== undefined && (!("effectId" in action) || action.effectId !== selector.effectId)) return false;
    if (selector.triggerId !== undefined && (!("triggerId" in action) || action.triggerId !== selector.triggerId)) return false;
    if (selector.triggerBucket !== undefined && (!("triggerBucket" in action) || action.triggerBucket !== selector.triggerBucket)) return false;
    if (selector.labelIncludes !== undefined && !action.label.includes(selector.labelIncludes)) return false;
    if (selector.groupLabel !== undefined && !groupKeys.has(JSON.stringify(action))) return false;
    return true;
  });
  return matches[selector.occurrence ?? 0];
}

function describeBattlefieldSelector(selector: DuelBattlefieldActionSelector): string {
  return [
    `player=${selector.player}`,
    `type=${selector.type}`,
    selector.windowId !== undefined ? `windowId=${selector.windowId}` : undefined,
    selector.windowKind !== undefined ? `windowKind=${selector.windowKind}` : undefined,
    selector.windowToken !== undefined ? `windowToken=${selector.windowToken}` : undefined,
    selector.uid ? `uid=${selector.uid}` : undefined,
    selector.phase !== undefined ? `phase=${selector.phase}` : undefined,
    selector.tributeUids !== undefined ? `tributeUids=${selector.tributeUids.join(",")}` : undefined,
    selector.materialUids !== undefined ? `materialUids=${selector.materialUids.join(",")}` : undefined,
    selector.summonUids !== undefined ? `summonUids=${selector.summonUids.join(",")}` : undefined,
    selector.attackerUid !== undefined ? `attackerUid=${selector.attackerUid}` : undefined,
    selector.targetUid !== undefined ? `targetUid=${selector.targetUid}` : undefined,
    selector.directAttack !== undefined ? `directAttack=${selector.directAttack}` : undefined,
    selector.promptId !== undefined ? `promptId=${selector.promptId}` : undefined,
    selector.option !== undefined ? `option=${selector.option}` : undefined,
    selector.yes !== undefined ? `yes=${selector.yes}` : undefined,
    selector.effectId !== undefined ? `effectId=${selector.effectId}` : undefined,
    selector.triggerId !== undefined ? `triggerId=${selector.triggerId}` : undefined,
    selector.triggerBucket !== undefined ? `triggerBucket=${selector.triggerBucket}` : undefined,
    selector.labelIncludes ? `labelIncludes=${selector.labelIncludes}` : undefined,
    selector.groupLabel ? `groupLabel=${selector.groupLabel}` : undefined,
    selector.occurrence !== undefined ? `occurrence=${selector.occurrence}` : undefined,
  ].filter(Boolean).join(" ");
}

function isMaterialSelectionAction(action: DuelAction): action is Extract<DuelAction, { materialUids: string[] }> {
  return action.type === "fusionSummon" || action.type === "synchroSummon" || action.type === "xyzSummon" || action.type === "linkSummon" || action.type === "ritualSummon";
}

function sameStringMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const remaining = new Map<string, number>();
  for (const value of a) remaining.set(value, (remaining.get(value) ?? 0) + 1);
  for (const value of b) {
    const count = remaining.get(value);
    if (!count) return false;
    if (count === 1) remaining.delete(value);
    else remaining.set(value, count - 1);
  }
  return remaining.size === 0;
}
