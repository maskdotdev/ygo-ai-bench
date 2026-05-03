import { findCard } from "#duel/card-state.js";
import { canUseEffectCount } from "#duel/effect-counts.js";
import { activePendingTriggerBucket } from "#duel/trigger-buckets.js";
import type { DuelAction, DuelState, PlayerId } from "#duel/types.js";

export function getPendingTriggerActions(state: DuelState, player: PlayerId): DuelAction[] {
  const activeBucket = activePendingTriggerBucket(state.pendingTriggers);
  if (!activeBucket || activeBucket.player !== player) return [];
  const actions: DuelAction[] = [];

  for (const trigger of state.pendingTriggers.filter((candidate) => candidate.player === player)) {
    const effect = state.effects.find((candidate) => candidate.id === trigger.effectId && candidate.sourceUid === trigger.sourceUid);
    if (trigger.triggerBucket !== activeBucket.triggerBucket) continue;

    const source = findCard(state, trigger.sourceUid);
    if (!source || !effect) continue;
    if (canUseEffectCount(state, effect)) actions.push({ type: "activateTrigger", player, triggerId: trigger.id, triggerBucket: trigger.triggerBucket, uid: source.uid, effectId: trigger.effectId, label: `${source.name}: ${trigger.effectId}` });
    if (effect?.optional !== false) actions.push({ type: "declineTrigger", player, triggerId: trigger.id, triggerBucket: trigger.triggerBucket, uid: source.uid, effectId: trigger.effectId, label: `Decline ${source.name}: ${trigger.effectId}` });
  }

  return actions;
}

export function pruneSpentMandatoryPendingTriggers(state: DuelState): void {
  state.pendingTriggers = state.pendingTriggers.filter((trigger) => {
    const effect = state.effects.find((candidate) => candidate.id === trigger.effectId && candidate.sourceUid === trigger.sourceUid);
    return effect?.optional !== false || canUseEffectCount(state, effect);
  });
  state.waitingFor = state.pendingTriggers[0]?.player ?? state.turnPlayer;
}
