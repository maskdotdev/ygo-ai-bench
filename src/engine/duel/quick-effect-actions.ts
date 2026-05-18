import { currentBattleWindowKind } from "#duel/battle-window-state.js";
import { findCard } from "#duel/card-state.js";
import { quickEffectEventContext } from "#duel/effect-event-context.js";
import { canUseEffectCount } from "#duel/effect-counts.js";
import { isBattleEndPhase, isBattleStartPhase } from "#duel/phase-mask.js";
import type { DuelAction, DuelCardInstance, DuelEffectDefinition, DuelState, PlayerId } from "#duel/types.js";

export type DuelEffectChooser = (state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId) => boolean;

const luaEffectTypeActivate = 0x10;
const timingBattleStart = 0x8;
const timingBattleEnd = 0x10;
const timingBattlePhase = 0x1000000;

export function quickEffectActions(state: DuelState, player: PlayerId, canChooseEffect: DuelEffectChooser): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const effect of state.effects) {
    if (effect.controller !== player || effect.event !== "quick") continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!quickEffectTimingAllows(state, effect, source)) continue;
    if (shouldRequireMatchingFirstChainEvent(state, effect) && quickEffectEventContext(state, effect) === undefined) continue;
    if (!chainLimitsAllow(state, effect, player)) continue;
    if (!canUseEffectCount(state, effect)) continue;
    if (!canChooseEffect(state, effect, source, player)) continue;
    actions.push({ type: "activateEffect", player, uid: source.uid, effectId: effect.id, label: `${source.name}: ${effect.id}` });
  }
  return actions;
}

export function hasQuickEffectResponses(state: DuelState, player: PlayerId, canChooseEffect: DuelEffectChooser): boolean {
  return quickEffectActions(state, player, canChooseEffect).length > 0;
}

function quickEffectTimingAllows(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance): boolean {
  const kind = currentBattleWindowKind(state);
  if (kind !== undefined && isBattleWindowTriggerEvent(effect.triggerEvent)) return battleWindowEventMatchesEffect(kind, effect);
  if (kind === "duringDamageCalculation") return battleWindowEventMatchesEffect(kind, effect) || Boolean((effect.property ?? 0) & 0x8000);
  if (kind === "startDamageStep" || kind === "beforeDamageCalculation" || kind === "afterDamageCalculation" || kind === "endDamageStep") {
    return battleWindowEventMatchesEffect(kind, effect) || Boolean((effect.property ?? 0) & 0x4000);
  }
  if (state.phase === "battle" && kind === undefined) return battleOpenQuickEffectTimingAllows(state, effect, source);
  return true;
}

function battleWindowEventMatchesEffect(kind: NonNullable<ReturnType<typeof currentBattleWindowKind>>, effect: DuelEffectDefinition): boolean {
  return (
    (kind === "startDamageStep" && effect.triggerEvent === "battleConfirmed") ||
    (kind === "beforeDamageCalculation" && effect.triggerEvent === "beforeDamageCalculation") ||
    (kind === "duringDamageCalculation" && effect.triggerEvent === "damageCalculating") ||
    (kind === "afterDamageCalculation" && effect.triggerEvent === "afterDamageCalculation") ||
    (kind === "endDamageStep" && (effect.triggerEvent === "battleDestroyed" || effect.triggerEvent === "damageStepEnded"))
  );
}

function isBattleWindowTriggerEvent(triggerEvent: DuelEffectDefinition["triggerEvent"]): boolean {
  return triggerEvent === "battleConfirmed"
    || triggerEvent === "battleDestroyed"
    || triggerEvent === "beforeDamageCalculation"
    || triggerEvent === "damageCalculating"
    || triggerEvent === "afterDamageCalculation"
    || triggerEvent === "damageStepEnded";
}

function battleOpenQuickEffectTimingAllows(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance): boolean {
  if (source.kind !== "monster" && ((effect.luaTypeFlags ?? 0) & luaEffectTypeActivate) !== 0) return true;
  const timing = effect.hintTiming;
  if (timing === undefined) return false;
  const activeMask = battleOpenTimingMask(state) | timingBattlePhase;
  return (((timing[0] ?? 0) | (timing[1] ?? 0)) & activeMask) !== 0;
}

function battleOpenTimingMask(state: DuelState): number {
  if (isBattleStartPhase(state)) return timingBattleStart;
  if (isBattleEndPhase(state)) return timingBattleEnd;
  return 0;
}

function shouldRequireMatchingFirstChainEvent(state: DuelState, effect: DuelEffectDefinition): boolean {
  if (effect.triggerEvent === undefined || isChainEvent(effect.triggerEvent)) return false;
  return state.chain.length > 0;
}

function isChainEvent(eventName: string): boolean {
  return eventName === "chainActivating" || eventName === "chaining" || eventName === "chainSolving" || eventName === "chainSolved" || eventName === "chainNegated" || eventName === "chainDisabled" || eventName === "chainEnded";
}

function chainLimitsAllow(state: DuelState, effect: DuelEffectDefinition, player: PlayerId): boolean {
  const link = state.chain[state.chain.length - 1];
  if (!link) return true;
  for (const limit of state.chainLimits) {
    if (!limit.untilChainEnd && limit.expiresAtChainLength !== state.chain.length) continue;
    if (!limit.allows(effect, player, link.player)) return false;
  }
  return true;
}
