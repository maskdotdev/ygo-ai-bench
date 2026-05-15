import { describeDuelActionSelector, selectDuelActionBySelector } from "#duel/action-selectors.js";
import { groupDuelLegalActions } from "#duel/legal-action-groups.js";
import { queryPublicState } from "#duel/snapshot.js";
import type { DuelAction, DuelResponse, DuelSession, PlayerId, ScriptedDuelRunResult, ScriptedResponseSelector } from "#duel/types.js";

export interface ScriptedDuelHandlers {
  getLegalActions(session: DuelSession, player: PlayerId): DuelAction[];
  applyResponse(session: DuelSession, response: unknown): { ok: boolean; error?: string };
}

export function runScriptedDuelResponses(
  session: DuelSession,
  steps: ScriptedResponseSelector[],
  handlers: ScriptedDuelHandlers,
): ScriptedDuelRunResult {
  for (let index = 0; index < steps.length; index += 1) {
    const selector = steps[index]!;
    const legalActions = handlers.getLegalActions(session, selector.player);
    const response = selectDuelActionBySelector(legalActions, selector, session.state.cards);
    if (!response) return scriptedRunResult(session, handlers, selector.player, index, `No legal response matched ${describeDuelActionSelector(selector)}`);
    const result = handlers.applyResponse(session, response);
    if (!result.ok) return scriptedRunResult(session, handlers, selector.player, index, result.error ?? `Rejected ${describeDuelActionSelector(selector)}`);
  }
  return scriptedRunResult(session, handlers);
}

function scriptedRunResult(
  session: DuelSession,
  handlers: ScriptedDuelHandlers,
  player: PlayerId = session.state.waitingFor ?? session.state.turnPlayer,
  failedStep?: number,
  failure?: string,
): ScriptedDuelRunResult {
  const legalActions = handlers.getLegalActions(session, player);
  const legalActionGroups = groupDuelLegalActions(legalActions);
  const divergenceGroup = legalActionGroups[0];
  const state = queryPublicState(session);
  return {
    ok: failure === undefined,
    ...(failedStep === undefined ? {} : { failedStep }),
    ...(failure === undefined
      ? {}
      : {
          failure,
          error: failure,
          divergencePlayer: player,
          divergenceWindowId: session.state.actionWindowId,
          divergenceWindowToken: session.state.actionWindowToken,
          divergenceActions: legalActions.map(copyDuelAction),
        }),
    ...(failure === undefined || state.windowKind === undefined ? {} : { divergenceWindowKind: state.windowKind }),
    ...(failure === undefined || divergenceGroup === undefined ? {} : { divergenceGroupKey: divergenceGroup.key, divergenceGroupLabel: divergenceGroup.label }),
    state,
    legalActions,
    legalActionGroups,
  };
}

function copyDuelAction(action: DuelAction): DuelAction {
  return { ...action };
}
