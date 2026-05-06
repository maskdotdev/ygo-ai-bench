import { setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";
import type { DuelState } from "#duel/types.js";

const chainEndedBlockingEvents = new Set(["chainSolved", "chainNegated", "chainDisabled"]);

export function collectDeferredChainEndedAfterDecline(
  state: DuelState,
  trigger: DuelState["pendingTriggers"][number],
  collectChainEnded: () => void,
): void {
  if (!chainEndedBlockingEvents.has(trigger.eventName) || state.chain.length > 0 || state.pendingTriggers.length > 0) return;
  collectChainEnded();
  setWaitingForPendingTriggerBucket(state);
}
