import { currentBattleWindowKind } from "#duel/battle-window-state.js";
import { findCard } from "#duel/card-state.js";
import { quickEffectEventContext } from "#duel/effect-event-context.js";
import { canUseEffectCount } from "#duel/effect-counts.js";
import { createEffectContext } from "#duel/effect-context.js";
import { isBattleEndPhase, isBattleStartPhase } from "#duel/phase-mask.js";
import { continuousEffectAppliesToCard } from "#duel/continuous-effects.js";
import type { DuelAction, DuelCardInstance, DuelEffectDefinition, DuelState, PlayerId } from "#duel/types.js";

export type DuelEffectChooser = (state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId) => boolean;

const luaEffectTypeActivate = 0x10;
const luaEffectTypeXMaterial = 0x1000;
const luaEffectTrapActInHand = 15;
const luaEffectQpActInNtpHand = 311;
const typeQuickPlay = 0x10000;
const typeCounter = 0x100000;
const timingBattleStart = 0x8;
const timingBattleEnd = 0x10;
const timingBattlePhase = 0x1000000;

export function quickEffectActions(state: DuelState, player: PlayerId, canChooseEffect: DuelEffectChooser): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const effect of state.effects) {
    if (effect.controller !== player || effect.event !== "quick") continue;
    const registeredSource = findCard(state, effect.sourceUid);
    const source = registeredSource ? activationSourceForEffect(state, effect, registeredSource, player) : undefined;
    if (!source || !activationEffectInUsableRange(state, effect, source, player)) continue;
    if (!quickEffectTimingAllows(state, effect, source)) continue;
    if (shouldRequireMatchingFirstChainEvent(state, effect) && quickEffectEventContext(state, effect) === undefined) continue;
    if (!chainLimitsAllow(state, effect, player)) continue;
    if (!canUseEffectCount(state, effect)) continue;
    if (!canChooseEffect(state, effect, source, player)) continue;
    actions.push({ type: "activateEffect", player, uid: source.uid, effectId: effect.id, label: `${source.name}: ${effect.id}` });
  }
  return actions;
}

export function activationEffectInUsableRange(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId): boolean {
  if (effect.range.includes(source.location)) return true;
  if (isXMaterialEffect(effect)) {
    const holder = xMaterialEffectHolder(state, effect, source, player);
    if (holder && effect.range.includes(holder.location)) return true;
  }
  if (((effect.luaTypeFlags ?? 0) & luaEffectTypeActivate) === 0 || source.location !== "hand") return false;
  return hasHandActivationGrant(state, effect, source, player);
}

export function activationSourceForEffect(
  state: DuelState,
  effect: DuelEffectDefinition,
  registeredSource: DuelCardInstance,
  player: PlayerId,
): DuelCardInstance | undefined {
  if (!isXMaterialEffect(effect)) return registeredSource;
  return xMaterialEffectHolder(state, effect, registeredSource, player) ?? registeredSource;
}

export function findActivationEffectForSource(
  state: DuelState,
  player: PlayerId,
  uid: string,
  effectId: string,
): { effect: DuelEffectDefinition; source: DuelCardInstance } | undefined {
  for (const effect of state.effects) {
    if (effect.id !== effectId) continue;
    const registeredSource = findCard(state, effect.sourceUid);
    if (!registeredSource) continue;
    const source = activationSourceForEffect(state, effect, registeredSource, player);
    if (source?.uid === uid) return { effect, source };
  }
  return undefined;
}

export function hasQuickEffectResponses(state: DuelState, player: PlayerId, canChooseEffect: DuelEffectChooser): boolean {
  return quickEffectActions(state, player, canChooseEffect).length > 0;
}

function quickEffectTimingAllows(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance): boolean {
  const kind = currentBattleWindowKind(state);
  if (kind !== undefined && isBattleWindowTriggerEvent(effect.triggerEvent)) return battleWindowEventMatchesEffect(kind, effect);
  if (kind === "duringDamageCalculation") return battleWindowEventMatchesEffect(kind, effect) || Boolean((effect.property ?? 0) & 0x8000) || isCounterTrapActivation(effect, source);
  if (kind === "startDamageStep" || kind === "beforeDamageCalculation" || kind === "afterDamageCalculation" || kind === "endDamageStep") {
    return battleWindowEventMatchesEffect(kind, effect) || Boolean((effect.property ?? 0) & 0x4000) || isCounterTrapActivation(effect, source);
  }
  if (state.phase === "battle" && kind === undefined) return battleOpenQuickEffectTimingAllows(state, effect, source);
  return true;
}

function isCounterTrapActivation(effect: DuelEffectDefinition, source: DuelCardInstance): boolean {
  return ((effect.luaTypeFlags ?? 0) & luaEffectTypeActivate) !== 0 && ((source.data.typeFlags ?? 0) & typeCounter) !== 0;
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

function hasHandActivationGrant(state: DuelState, effect: DuelEffectDefinition, card: DuelCardInstance, player: PlayerId): boolean {
  for (const grant of state.effects) {
    if (grant.event !== "continuous") continue;
    if (!handActivationGrantMatchesCard(grant, card, state.turnPlayer !== player)) continue;
    const source = findCard(state, grant.sourceUid);
    if (!source || !grant.range.includes(source.location)) continue;
    if (!continuousEffectAppliesToCard(grant, source, card, createEffectContext(state, card, player))) continue;
    if (grant.canActivate && !grant.canActivate(createEffectContext(state, source, grant.controller))) continue;
    if (effect.canActivate && !effect.canActivate(createEffectContext(state, card, player))) continue;
    return true;
  }
  return false;
}

function handActivationGrantMatchesCard(effect: DuelEffectDefinition, card: DuelCardInstance, opponentTurn: boolean): boolean {
  if (effect.code === luaEffectTrapActInHand) return card.kind === "trap";
  return effect.code === luaEffectQpActInNtpHand && opponentTurn && card.kind === "spell" && ((card.data.typeFlags ?? 0) & typeQuickPlay) !== 0;
}

function isXMaterialEffect(effect: DuelEffectDefinition): boolean {
  return ((effect.luaTypeFlags ?? 0) & luaEffectTypeXMaterial) !== 0;
}

function xMaterialEffectHolder(
  state: DuelState,
  effect: DuelEffectDefinition,
  material: DuelCardInstance,
  player: PlayerId,
): DuelCardInstance | undefined {
  if (material.location !== "overlay") return undefined;
  return state.cards.find((card) =>
    card.controller === player &&
    card.location === "monsterZone" &&
    card.overlayUids.includes(material.uid) &&
    effect.range.includes(card.location)
  );
}
