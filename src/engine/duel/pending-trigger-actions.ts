import { findCard } from "#duel/card-state.js";
import { canUseEffectCount } from "#duel/effect-counts.js";
import type { DuelAction, DuelState, PlayerId } from "#duel/types.js";

export function getPendingTriggerActions(state: DuelState, player: PlayerId): DuelAction[] {
  const firstTrigger = state.pendingTriggers[0];
  if (!firstTrigger) return [];

  const firstEffect = state.effects.find((candidate) => candidate.id === firstTrigger.effectId && candidate.sourceUid === firstTrigger.sourceUid);
  const firstOptional = firstEffect?.optional !== false;
  const actions: DuelAction[] = [];

  for (const trigger of state.pendingTriggers.filter((candidate) => candidate.player === player)) {
    const effect = state.effects.find((candidate) => candidate.id === trigger.effectId && candidate.sourceUid === trigger.sourceUid);
    if (trigger.player !== firstTrigger.player || (effect?.optional !== false) !== firstOptional) continue;

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
