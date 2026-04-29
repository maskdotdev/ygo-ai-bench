import { findCard } from "#duel/card-state.js";
import { canUseEffectCount } from "#duel/effect-counts.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelEventName, DuelState, PendingTrigger } from "#duel/types.js";

export type DuelTriggerChooser = (state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, eventName: DuelEventName, eventCard?: DuelCardInstance) => boolean;

export function collectTriggerEffects(state: DuelState, eventName: DuelEventName, canChooseEffect: DuelTriggerChooser, eventCard?: DuelCardInstance): void {
  const collected: Array<{ effect: DuelEffectDefinition; source: DuelCardInstance; index: number }> = [];
  for (const [index, effect] of state.effects.entries()) {
    if (effect.event !== "trigger" || effect.triggerEvent !== eventName) continue;
    if (!canUseEffectCount(state, effect)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!canChooseEffect(state, effect, source, eventName, eventCard)) continue;
    collected.push({ effect, source, index });
  }
  collected.sort((a, b) => triggerPriority(state, a.effect) - triggerPriority(state, b.effect) || a.index - b.index);
  for (const trigger of collected) state.pendingTriggers.push(createPendingTrigger(state, trigger.effect, trigger.source, eventName, eventCard));
  state.waitingFor = state.pendingTriggers[0]?.player ?? state.turnPlayer;
}

function triggerPriority(state: DuelState, effect: DuelEffectDefinition): number {
  const optionalOffset = effect.optional === false ? 0 : 2;
  return optionalOffset + (effect.controller === state.turnPlayer ? 0 : 1);
}

function createPendingTrigger(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, eventName: DuelEventName, eventCard?: DuelCardInstance): PendingTrigger {
  return {
    id: `trigger-${state.log.length + 1}-${state.pendingTriggers.length + 1}`,
    player: effect.controller,
    sourceUid: source.uid,
    effectId: effect.id,
    eventName,
    ...(eventCard === undefined ? {} : { eventCardUid: eventCard.uid }),
  };
}
