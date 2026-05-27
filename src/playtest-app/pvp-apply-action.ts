import { applyResponse, getLegalActions } from "#duel/core.js";
import type { ApplyDuelResponseResult, DuelAction, DuelSession } from "#duel/types.js";

const MAX_AUTO_PASSES = 8;

export function applyPvpAction(session: DuelSession, action: DuelAction): ApplyDuelResponseResult {
  let result = applyResponse(session, action);
  if (!result.ok) return result;
  for (let i = 0; i < MAX_AUTO_PASSES; i += 1) {
    const waiting = result.state.waitingFor;
    if (result.state.status !== "awaiting" || waiting === undefined || result.state.windowKind !== "chainResponse") break;
    const legal = getLegalActions(session, waiting);
    if (legal.length !== 1 || legal[0]?.type !== "passChain") break;
    result = applyResponse(session, legal[0]);
    if (!result.ok) return result;
  }
  return result;
}
