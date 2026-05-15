import {
  applyResponse,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  queryPublicState,
} from "#duel/core.js";
import type { DuelAction, DuelSession, PlayerId, PublicDuelState } from "#duel/types.js";
import { duelActionAnchorUids, duelActionUiGroupLabel, type DuelActionUiGroup } from "./duel-action-anchors.js";
import { duelBattlefieldActionView, visibleDuelBattlefieldActions } from "./duel-battlefield-actions.js";

export interface DuelBattlefieldActionSelector {
  player: PlayerId;
  type: DuelAction["type"];
  uid?: string;
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

function battlefieldScriptResult(
  session: DuelSession,
  player: PlayerId,
  failedStep?: number,
  failure?: string,
): DuelBattlefieldScriptResult {
  const view = battlefieldScriptView(session, player);
  return {
    ok: failedStep === undefined,
    state: queryPublicState(session),
    ...(failedStep === undefined ? {} : { failedStep }),
    ...(failure === undefined ? {} : { failure }),
    visibleActions: view.visibleActions.map((action) => ({ ...action })),
    visibleGroups: view.visibleGroups.map((group) => ({
      ...group,
      label: duelActionUiGroupLabel(group),
      actions: group.actions.map((action) => ({ ...action })),
    })),
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
    if (selector.uid !== undefined && !duelActionAnchorUids(action).includes(selector.uid)) return false;
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
    selector.uid ? `uid=${selector.uid}` : undefined,
    selector.labelIncludes ? `labelIncludes=${selector.labelIncludes}` : undefined,
    selector.groupLabel ? `groupLabel=${selector.groupLabel}` : undefined,
  ].filter(Boolean).join(" ");
}
