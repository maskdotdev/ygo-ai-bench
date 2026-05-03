import type { DuelState, PendingTrigger, PendingTriggerBucketState, TriggerBucket } from "#duel/types.js";

const triggerBucketOrder: TriggerBucket[] = ["turnMandatory", "opponentMandatory", "turnOptional", "opponentOptional"];

export function pendingTriggerBuckets(triggers: PendingTrigger[]): PendingTriggerBucketState[] {
  return triggerBucketOrder.flatMap((bucket) => {
    const triggerIds = triggers.filter((trigger) => trigger.triggerBucket === bucket).map((trigger) => trigger.id);
    if (triggerIds.length === 0) return [];
    const player = triggers.find((trigger) => trigger.triggerBucket === bucket)!.player;
    return [{ triggerBucket: bucket, player, triggerIds }];
  });
}

export function activePendingTriggerBucket(triggers: PendingTrigger[]): PendingTriggerBucketState | undefined {
  return pendingTriggerBuckets(triggers)[0];
}

export function setWaitingForPendingTriggerBucket(state: DuelState): void {
  state.waitingFor = activePendingTriggerBucket(state.pendingTriggers)?.player ?? state.turnPlayer;
}
