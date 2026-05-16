import {
  applyResponse,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  queryPublicState,
} from "#duel/core.js";
import { copyDuelAction } from "#duel/action-copy.js";
import type { ApplyDuelResponseResult, DuelAction, DuelActionWindowKind, DuelPhase, DuelSession, PlayerId, PublicDuelState, TriggerBucket } from "#duel/types.js";
import type { LuaPromptDecision } from "#lua/host-types.js";
import { duelActionAnchorUids, duelActionUiGroupLabel, duelActionUiGroupSelectionKind, type DuelActionUiGroup, type DuelActionUiSelectionKind } from "./duel-action-anchors.js";
import { duelBattlefieldActionView, visibleDuelBattlefieldActions } from "./duel-battlefield-actions.js";
import { duelPromptView, type DuelPromptView } from "./duel-prompt-view.js";
import { copyDuelTriggerOrderView, duelTriggerOrderView, type DuelTriggerOrderView } from "./duel-trigger-order-view.js";

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
  luaPromptApi?: LuaPromptDecision["api"];
  promptDescription?: number;
  promptDescriptionList?: readonly number[];
  option?: number;
  yes?: boolean;
  effectId?: string;
  triggerId?: string;
  triggerBucket?: TriggerBucket;
  labelIncludes?: string;
  groupLabel?: string;
  groupSelectionKind?: DuelActionUiSelectionKind;
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
  triggerOrder?: DuelTriggerOrderView;
}

export interface DuelBattlefieldScriptStepResult extends DuelBattlefieldScriptResult {
  nextStep: number;
  done: boolean;
  appliedAction?: DuelAction;
}

export interface DuelBattlefieldScriptRuntime {
  getLegalActions(session: DuelSession, player: PlayerId): DuelAction[];
  getGroupedLegalActions(session: DuelSession, player: PlayerId): ReturnType<typeof getGroupedDuelLegalActions>;
  applyResponse(session: DuelSession, action: DuelAction): ApplyDuelResponseResult;
}

const defaultBattlefieldScriptRuntime: DuelBattlefieldScriptRuntime = {
  getLegalActions: getDuelLegalActions,
  getGroupedLegalActions: getGroupedDuelLegalActions,
  applyResponse,
};

export function runDuelBattlefieldScript(
  session: DuelSession,
  steps: readonly DuelBattlefieldActionSelector[],
  runtime: DuelBattlefieldScriptRuntime = defaultBattlefieldScriptRuntime,
): DuelBattlefieldScriptResult {
  for (let index = 0; index < steps.length; index += 1) {
    const selector = steps[index]!;
    const view = battlefieldScriptView(session, selector.player, runtime);
    const action = selectVisibleBattlefieldAction(selector, view.visibleActions, view.visibleGroups, view.prompt);
    if (!action) {
      return battlefieldScriptResult(session, selector.player, runtime, index, `No visible battlefield action matched ${describeBattlefieldSelector(selector)}`);
    }
    const result = runtime.applyResponse(session, action);
    if (!result.ok) {
      return battlefieldScriptResult(session, selector.player, runtime, index, result.error ?? `Rejected ${describeBattlefieldSelector(selector)}`);
    }
  }
  const lastPlayer = steps[steps.length - 1]?.player ?? 0;
  return battlefieldScriptResult(session, lastPlayer, runtime);
}

export function runDuelBattlefieldScriptStep(
  session: DuelSession,
  steps: readonly DuelBattlefieldActionSelector[],
  step: number,
  runtime: DuelBattlefieldScriptRuntime = defaultBattlefieldScriptRuntime,
): DuelBattlefieldScriptStepResult {
  if (!Number.isInteger(step) || step < 0) {
    return {
      ...battlefieldScriptResult(session, 0, runtime, 0, `Invalid script step ${step}`),
      nextStep: 0,
      done: true,
    };
  }
  if (step >= steps.length) {
    const lastPlayer = steps[steps.length - 1]?.player ?? 0;
    return {
      ...battlefieldScriptResult(session, lastPlayer, runtime),
      nextStep: steps.length,
      done: true,
    };
  }

  const selector = steps[step]!;
  const view = battlefieldScriptView(session, selector.player, runtime);
  const action = selectVisibleBattlefieldAction(selector, view.visibleActions, view.visibleGroups, view.prompt);
  if (!action) {
    return {
      ...battlefieldScriptResult(session, selector.player, runtime, step, `No visible battlefield action matched ${describeBattlefieldSelector(selector)}`),
      nextStep: step,
      done: true,
    };
  }
  const result = runtime.applyResponse(session, action);
  if (!result.ok) {
    return {
      ...battlefieldScriptResult(session, selector.player, runtime, step, result.error ?? `Rejected ${describeBattlefieldSelector(selector)}`),
      nextStep: step,
      done: true,
    };
  }

  const nextStep = step + 1;
  return {
    ...battlefieldScriptResult(session, selector.player, runtime),
    nextStep,
    done: nextStep >= steps.length,
    appliedAction: copyDuelAction(action),
  };
}

function battlefieldScriptResult(
  session: DuelSession,
  player: PlayerId,
  runtime: DuelBattlefieldScriptRuntime,
  failedStep?: number,
  failure?: string,
): DuelBattlefieldScriptResult {
  const state = queryPublicState(session);
  const view = battlefieldScriptView(session, player, runtime);
  const visibleGroups = view.visibleGroups.map((group) => ({
    ...group,
    label: duelActionUiGroupLabel(group),
    actions: group.actions.map(copyDuelAction),
  }));
  const prompt = duelPromptView(state.prompt, visibleGroups, state.luaOperationPrompt);
  const triggerOrder = duelTriggerOrderView(state.triggerOrderPrompt, view.legalGroups);
  return {
    ok: failedStep === undefined,
    state,
    ...(failedStep === undefined ? {} : { failedStep }),
    ...(failure === undefined ? {} : { failure }),
    visibleActions: view.visibleActions.map(copyDuelAction),
    visibleGroups,
    ...(prompt === undefined ? {} : { prompt }),
    ...(triggerOrder === undefined ? {} : { triggerOrder: copyDuelTriggerOrderView(triggerOrder) }),
  };
}

function battlefieldScriptView(
  session: DuelSession,
  player: PlayerId,
  runtime: DuelBattlefieldScriptRuntime,
): { visibleActions: DuelAction[]; visibleGroups: DuelActionUiGroup[]; legalGroups: ReturnType<typeof getGroupedDuelLegalActions>; prompt?: DuelPromptView } {
  const state = queryPublicState(session);
  const legalGroups = runtime.getGroupedLegalActions(session, player);
  const view = duelBattlefieldActionView(
    state,
    player,
    runtime.getLegalActions(session, player),
    legalGroups,
  );
  const prompt = duelPromptView(state.prompt, view.orphanGroups, state.luaOperationPrompt);
  return {
    visibleActions: visibleDuelBattlefieldActions(view),
    visibleGroups: view.orphanGroups,
    legalGroups,
    ...(prompt === undefined ? {} : { prompt }),
  };
}

function selectVisibleBattlefieldAction(
  selector: DuelBattlefieldActionSelector,
  visibleActions: readonly DuelAction[],
  visibleGroups: readonly DuelActionUiGroup[],
  prompt?: DuelPromptView,
): DuelAction | undefined {
  const groupKeys = selector.groupLabel === undefined && selector.groupSelectionKind === undefined
    ? undefined
    : new Set(visibleGroups
      .filter((group) => selector.groupLabel === undefined || duelActionUiGroupLabel(group) === selector.groupLabel)
      .filter((group) => selector.groupSelectionKind === undefined || group.selectionKind === selector.groupSelectionKind)
      .flatMap((group) => group.actions.map((action) => JSON.stringify(action))));
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
      if (action.type !== "pendulumSummon" || !isPendulumSummonSelection(action.summonUids, selector.summonUids, action.maxSummons)) return false;
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
    if (selector.luaPromptApi !== undefined && !actionMatchesLuaPromptApi(action, prompt, selector.luaPromptApi)) return false;
    if (selector.promptDescription !== undefined && !actionMatchesPromptDescription(action, prompt, selector.promptDescription)) return false;
    if (selector.promptDescriptionList !== undefined && !actionMatchesPromptDescriptionList(action, prompt, selector.promptDescriptionList)) return false;
    if (selector.option !== undefined && (action.type !== "selectOption" || action.option !== selector.option)) return false;
    if (selector.yes !== undefined && (action.type !== "selectYesNo" || action.yes !== selector.yes)) return false;
    if (selector.effectId !== undefined && (!("effectId" in action) || action.effectId !== selector.effectId)) return false;
    if (selector.triggerId !== undefined && (!("triggerId" in action) || action.triggerId !== selector.triggerId)) return false;
    if (selector.triggerBucket !== undefined && (!("triggerBucket" in action) || action.triggerBucket !== selector.triggerBucket)) return false;
    if (selector.labelIncludes !== undefined && !action.label.includes(selector.labelIncludes)) return false;
    if (selector.groupLabel !== undefined && !groupKeys?.has(JSON.stringify(action))) return false;
    if (selector.groupSelectionKind !== undefined && !groupKeys?.has(JSON.stringify(action)) && actionSelectionKind(action) !== selector.groupSelectionKind) return false;
    return true;
  });
  const selected = matches[selector.occurrence ?? 0];
  if (selected?.type === "pendulumSummon" && selector.summonUids !== undefined) return { ...selected, summonUids: [...selector.summonUids] };
  return selected;
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
    selector.luaPromptApi !== undefined ? `luaPromptApi=${selector.luaPromptApi}` : undefined,
    selector.promptDescription !== undefined ? `promptDescription=${selector.promptDescription}` : undefined,
    selector.promptDescriptionList !== undefined ? `promptDescriptionList=${selector.promptDescriptionList.join(",")}` : undefined,
    selector.option !== undefined ? `option=${selector.option}` : undefined,
    selector.yes !== undefined ? `yes=${selector.yes}` : undefined,
    selector.effectId !== undefined ? `effectId=${selector.effectId}` : undefined,
    selector.triggerId !== undefined ? `triggerId=${selector.triggerId}` : undefined,
    selector.triggerBucket !== undefined ? `triggerBucket=${selector.triggerBucket}` : undefined,
    selector.labelIncludes ? `labelIncludes=${selector.labelIncludes}` : undefined,
    selector.groupLabel ? `groupLabel=${selector.groupLabel}` : undefined,
    selector.groupSelectionKind ? `groupSelectionKind=${selector.groupSelectionKind}` : undefined,
    selector.occurrence !== undefined ? `occurrence=${selector.occurrence}` : undefined,
  ].filter(Boolean).join(" ");
}

function isMaterialSelectionAction(action: DuelAction): action is Extract<DuelAction, { materialUids: string[] }> {
  return action.type === "fusionSummon" || action.type === "synchroSummon" || action.type === "xyzSummon" || action.type === "linkSummon" || action.type === "ritualSummon";
}

function actionSelectionKind(action: DuelAction): DuelActionUiSelectionKind | undefined {
  return duelActionUiGroupSelectionKind({ actions: [action], windowKind: action.windowKind });
}

function actionMatchesLuaPromptApi(action: DuelAction, prompt: DuelPromptView | undefined, luaPromptApi: LuaPromptDecision["api"]): boolean {
  if (prompt?.luaPrompt?.api !== luaPromptApi) return false;
  return promptChoiceForAction(action, prompt) !== undefined;
}

function actionMatchesPromptDescription(action: DuelAction, prompt: DuelPromptView | undefined, description: number): boolean {
  const choice = promptChoiceForAction(action, prompt);
  return choice !== undefined && "description" in choice && choice.description === description;
}

function actionMatchesPromptDescriptionList(action: DuelAction, prompt: DuelPromptView | undefined, descriptionList: readonly number[]): boolean {
  const choice = promptChoiceForAction(action, prompt);
  return choice !== undefined && "descriptionList" in choice && sameNumberMembers(choice.descriptionList ?? [], descriptionList);
}

function promptChoiceForAction(action: DuelAction, prompt: DuelPromptView | undefined): DuelPromptView["choices"][number] | undefined {
  if (prompt === undefined) return undefined;
  return prompt.choices.find((choice) => {
    if (choice.type === "selectOption") {
      return action.type === "selectOption" &&
        action.promptId === choice.action.promptId &&
        action.player === choice.action.player &&
        action.option === choice.action.option;
    }
    return action.type === "selectYesNo" &&
      action.promptId === choice.action.promptId &&
      action.player === choice.action.player &&
      action.yes === choice.action.yes;
  });
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

function sameNumberMembers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const remaining = new Map<number, number>();
  for (const value of a) remaining.set(value, (remaining.get(value) ?? 0) + 1);
  for (const value of b) {
    const count = remaining.get(value);
    if (!count) return false;
    if (count === 1) remaining.delete(value);
    else remaining.set(value, count - 1);
  }
  return remaining.size === 0;
}

function isPendulumSummonSelection(candidates: readonly string[], selected: readonly string[], maxSummons: number): boolean {
  if (!selected.length || selected.length > candidates.length || selected.length > maxSummons) return false;
  if (new Set(selected).size !== selected.length) return false;
  return selected.every((uid) => candidates.includes(uid));
}
