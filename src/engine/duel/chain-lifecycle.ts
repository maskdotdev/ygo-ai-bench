import { setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";
import type { DuelState } from "#duel/types.js";

export function collectDeferredChainEndedAfterDecline(
  state: DuelState,
  trigger: DuelState["pendingTriggers"][number],
  collectChainEnded: () => void,
): void {
  if (trigger.eventName !== "chainSolved" || state.chain.length > 0 || state.pendingTriggers.length > 0) return;
  collectChainEnded();
  setWaitingForPendingTriggerBucket(state);
}
