import type { DuelState, PendingTrigger, PendingTriggerBucketState, TriggerBucket } from "#duel/types.js";

export const triggerBucketOrder: readonly TriggerBucket[] = ["turnMandatory", "opponentMandatory", "turnOptional", "opponentOptional"];

const triggerBuckets = new Set<TriggerBucket>(triggerBucketOrder);

export function isTriggerBucket(value: unknown): value is TriggerBucket {
  return triggerBuckets.has(value as TriggerBucket);
}

export function pendingTriggerBuckets(triggers: PendingTrigger[]): PendingTriggerBucketState[] {
  return triggerBucketOrder.flatMap((bucket) => {
    const triggerIds = triggers.filter((trigger) => trigger.triggerBucket === bucket).map((trigger) => trigger.id);
    if (triggerIds.length === 0) return [];
    const player = triggers.find((trigger) => trigger.triggerBucket === bucket)!.player;
    return [{ triggerBucket: bucket, player, triggerIds }];
  });
}

export function pendingTriggerBucketsForState(state: DuelState): PendingTriggerBucketState[] {
  assertPendingTriggerBucketPlayers(state);
  return pendingTriggerBuckets(state.pendingTriggers);
}

export function setWaitingForPendingTriggerBucket(state: DuelState): void {
  state.waitingFor = pendingTriggerBucketsForState(state)[0]?.player ?? state.turnPlayer;
}

function assertPendingTriggerBucketPlayers(state: DuelState): void {
  for (const trigger of state.pendingTriggers) {
    const turnBucket = trigger.triggerBucket === "turnMandatory" || trigger.triggerBucket === "turnOptional";
    if ((turnBucket && trigger.player !== state.turnPlayer) || (!turnBucket && trigger.player === state.turnPlayer)) {
      throw new Error(`Pending trigger ${trigger.id} bucket ${trigger.triggerBucket} does not match player ${trigger.player}`);
    }
  }
}
