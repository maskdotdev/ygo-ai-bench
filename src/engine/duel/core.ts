import { markDuelPhaseActivity, recordSpecialSummonActivity } from "#duel/activity.js";
import { clearChainLimits, clearStaleChainLimits } from "#duel/chain-limits.js";
import { isDuelMonsterLike, isFaceUpPendulumExtraDeckCard } from "#duel/card-predicates.js";
import {
  findCard,
  canMoveDuelCardToLocation as canMoveDuelCardToLocationRule,
  getCards,
  hasZoneSpace,
  moveDuelCard,
  pushDuelLog,
  requireZoneSpace,
} from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import { isNoTributeSummonAllowed } from "#duel/no-tribute.js";
import {
  flipSummonActions,
  flipSummonDuelCard as flipSummonDuelCardWithEvents,
  fusionSummonActions,
  fusionSummonDuelCard as fusionSummonDuelCardWithEvents,
  linkSummonActions,
  linkSummonDuelCard as linkSummonDuelCardWithEvents,
  normalSummon,
  normalSummonActions,
  ritualSummonActions,
  ritualSummonDuelCard as ritualSummonDuelCardWithEvents,
  setMonster,
  synchroSummonActions,
  synchroSummonDuelCard as synchroSummonDuelCardWithEvents,
  tributeSummonActions,
  tributeSummonDuelCard as tributeSummonDuelCardWithEvents,
  type DuelMaterialMover,
  type DuelMaterialPredicate,
  type DuelOverlayMaterialMover,
  xyzSummonActions,
  xyzSummonDuelCard as xyzSummonDuelCardWithEvents,
} from "#duel/summon.js";
import {
  activateDuelEffect,
  activateDuelPendingTrigger,
  declineDuelPendingTrigger,
  specialSummonDuelByProcedure,
  type DuelActivationHandlers,
} from "#duel/effect-activation.js";
import { captureDuelState, restoreDuelState } from "#duel/state-rollback.js";
import {
  cancelReplayAttack,
  getDuelAttackCostPaid as getDuelAttackCostPaidRule,
  replayDuelAttack,
  setDuelAttackCostPaid as setDuelAttackCostPaidRule,
} from "#duel/battle.js";
import {
  appendBattleActions,
  canCoreChangeDuelCardPosition,
  canCoreAttackTarget,
  canCoreDuelCardAttack,
  changeCoreDuelCardPosition,
  coreReplayAttackActions,
  corePositionChangeActions,
  declareCoreDuelAttack,
  getCoreDuelAttackTargets,
  getCoreAdditionalBattleDamagePlayers,
  getCoreBattleAttackValue,
  getCoreBattleDamageReason,
  getCoreBattleDefenseValue,
  hasCoreMustAttackAction,
  hasCorePiercingBattleDamage,
  negateCoreDuelAttack,
  replayCoreDuelAttack,
  type CoreBattleHandlers,
} from "#duel/core-battle.js";
import { battleWindowActions } from "#duel/battle-window-actions.js";
import {
  continueAttackResponseWindow,
  markBattleWindowChainStarted,
  passAttackResponseWindow,
  passDamageResponseWindow,
} from "#duel/attack-response-window.js";
import type { BattleContinuationHandlers } from "#duel/battle-continuation.js";
import {
  isDrawPrevented,
  isDeckDiscardPrevented,
  isDeckLossDefeatPrevented,
  isChainLinkNegationPrevented,
  isEffectActivationPrevented,
  isMaterialUsePrevented,
  isFlipSummonPrevented,
  isHandDiscardPrevented,
  isMonsterSetPrevented,
  isMoveToLocationPrevented,
  isNormalSummonPrevented,
  isPhaseEntryPrevented,
  isReleasePrevented,
  isSpellTrapSetPrevented,
  isSpecialSummonPrevented,
  type ContinuousEffectContextFactory,
} from "#duel/continuous-effects.js";
import {
  changeDuelBattleDamageWithPrevention as changeDuelBattleDamageWithPreventionRule,
  reflectedDuelBattleDamagePlayer as reflectedDuelBattleDamagePlayerRule,
} from "#duel/core-battle-damage.js";
import {
  banishCoreDuelCard,
  destroyCoreDuelCard,
  detachCoreDuelOverlayMaterials,
  moveCoreDuelCardWithRedirects,
  sendCoreDuelCardToGraveyard,
  type CoreMovementHandlers,
} from "#duel/core-movement.js";
import { canUseEffectCount, markEffectUsed } from "#duel/effect-counts.js";
import { duelEventCode } from "#duel/event-codes.js";
import { recordDuelEvent } from "#duel/event-history.js";
import { pruneResetEffectsAfterChain } from "#duel/effect-reset.js";
import { pruneDuelFlagEffectsAfterChain } from "#duel/flags.js";
import type { ReplacementEffectHandlers } from "#duel/replacement-effects.js";
import { getPendingTriggerActions } from "#duel/pending-trigger-actions.js";
import { groupDuelLegalActions } from "#duel/legal-action-groups.js";
export { groupDuelLegalActions } from "#duel/legal-action-groups.js";
export type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
export { describeDuelActionSelector, duelActionMatchesSelector, selectDuelActionBySelector } from "#duel/action-selectors.js";
import { phaseMask } from "#duel/phase-mask.js";
import { damageDuelPlayer, recoverDuelPlayer, setDuelPlayerLifePoints } from "#duel/player-life.js";
import { getPromptResponseActions, resolveDuelPrompt, stampDuelActions } from "#duel/prompt-response.js";
import { hasQuickEffectResponses, quickEffectActions as getQuickEffectActions } from "#duel/quick-effect-actions.js";
import { applyDuelResponse, type DuelResponseHandlers } from "#duel/response-dispatch.js";
import { runScriptedDuelResponses as runScriptedDuelResponsesWithHandlers } from "#duel/scripted-runner.js";
import { setSpellTrap } from "#duel/spell-trap.js";
import { collectTriggerEffects as collectTriggerEffectsRule } from "#duel/triggers.js";
import { changeDuelPhase, drawDuelCardsFromDeck, endDuelTurn, nextAvailableDuelPhase } from "#duel/turn-flow.js";
export { createDuel, loadDecks, startDuel, type CreateDuelOptions } from "#duel/setup.js";
import type {
  ApplyDuelResponseResult,
  CardPosition,
  ChainLink,
  DuelAction,
  DuelCardInstance,
  DuelEffectContext,
  DuelEffectDefinition,
  DuelEventName,
  DuelLocation,
  DuelPhase,
  DuelResponse,
  DuelSession,
  DuelState,
  DuelStatus,
  PlayerId,
  ScriptedDuelRunResult,
  ScriptedResponseSelector,
} from "#duel/types.js";

export { moveDuelCard } from "#duel/card-state.js";
export { damageDuelPlayer, recoverDuelPlayer, setDuelPlayerLifePoints } from "#duel/player-life.js";
export { queryPublicState, serializeDuel, restoreDuel } from "#duel/snapshot.js";
export { changeDuelBattleDamage, getDuelBattleDamage } from "#duel/core-battle-damage.js";

const activationHandlers: DuelActivationHandlers = {
  createEffectContext,
  pushChainLink,
  hasChainResponses,
  resolveChain,
  canAttemptSpecialSummonProcedure,
  canSpecialSummonCard: canSpecialSummonDuelCard,
  specialSummonCard: specialSummonDuelCard,
};

const battleContinuationHandlers: BattleContinuationHandlers = {
  additionalBattleDamagePlayers: (state, player, battleCards) => getCoreAdditionalBattleDamagePlayers(state, player, battleCards, coreBattleHandlers),
  battleDamagePlayer: (state, player, battleCards) => reflectedDuelBattleDamagePlayerRule(state, player, createContinuousEffectContext(state), battleCards),
  battleDamageReason: (state, player, battleCards) => getCoreBattleDamageReason(state, player, battleCards, coreBattleHandlers),
  canAttackTarget: (state, attacker, target) => canCoreAttackTarget(state, attacker, target, coreBattleHandlers),
  collectEvent: (state, eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard),
  changeBattleDamage: (state, player, amount, battleCards) => changeDuelBattleDamageWithPreventionRule(state, player, amount, createContinuousEffectContext(state), battleCards),
  damagePlayer: damageDuelPlayer,
  destroyCard: destroyDuelCard,
  getAttackValue: (state, card) => getCoreBattleAttackValue(state, card, coreBattleHandlers),
  getDefenseValue: (_state, card) => getCoreBattleDefenseValue(card),
  hasPiercingDamage: (state, card) => hasCorePiercingBattleDamage(state, card, coreBattleHandlers),
};

const coreBattleHandlers: CoreBattleHandlers = {
  additionalBattleDamagePlayers: (state, player, battleCards) => getCoreAdditionalBattleDamagePlayers(state, player, battleCards, coreBattleHandlers),
  battleDamagePlayer: (state, player, battleCards) => reflectedDuelBattleDamagePlayerRule(state, player, createContinuousEffectContext(state), battleCards),
  battleDamageReason: (state, player, battleCards) => getCoreBattleDamageReason(state, player, battleCards, coreBattleHandlers),
  collectEvent: (state, eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard),
  changeBattleDamage: (state, player, amount, battleCards) => changeDuelBattleDamageWithPreventionRule(state, player, amount, createContinuousEffectContext(state), battleCards),
  createContinuousContext: createContinuousEffectContext,
  damagePlayer: damageDuelPlayer,
  destroyCard: destroyDuelCard,
  getAttackValue: (state, card) => getCoreBattleAttackValue(state, card, coreBattleHandlers),
  getDefenseValue: (_state, card) => getCoreBattleDefenseValue(card),
  hasPiercingDamage: (state, card) => hasCorePiercingBattleDamage(state, card, coreBattleHandlers),
};

const coreMovementHandlers: CoreMovementHandlers = {
  canMoveCardToLocation: canMoveDuelCardToLocation,
  collectTrigger: (state, eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard),
  createContinuousContext: createContinuousEffectContext,
  createReplacementHandlers: createReplacementEffectHandlers,
};

const responseHandlers: DuelResponseHandlers = {
  getLegalActions,
  normalSummon(state, player, uid) {
    const card = findCard(state, uid);
    if (card && isNormalSummonPrevented(state, player, card, createContinuousEffectContext(state))) throw new Error(`${card.name} cannot be Normal Summoned`);
    normalSummon(state, player, uid, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), () => isNoTributeSummonAllowed(state, player));
  },
  tributeSummon: tributeSummonDuelCard,
  fusionSummon: fusionSummonDuelCard,
  synchroSummon: synchroSummonDuelCard,
  xyzSummon: xyzSummonDuelCard,
  linkSummon: linkSummonDuelCard,
  ritualSummon: ritualSummonDuelCard,
  specialSummonProcedure(session, player, uid, effectId) {
    specialSummonDuelByProcedure(session, player, uid, effectId, activationHandlers);
  },
  setMonster(state, player, uid) {
    const card = findCard(state, uid);
    if (card && isMonsterSetPrevented(state, player, card, createContinuousEffectContext(state))) throw new Error(`${card.name} cannot be Set`);
    setMonster(state, player, uid, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
  },
  setSpellTrap(state, player, uid) {
    const card = findCard(state, uid);
    if (card && isSpellTrapSetPrevented(state, player, card, createContinuousEffectContext(state))) throw new Error(`${card.name} cannot be Set`);
    setSpellTrap(state, player, uid, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
  },
  activateEffect(session, player, uid, effectId) {
    const source = findCard(session.state, uid);
    if (source && isEffectActivationPrevented(session.state, player, source, createContinuousEffectContext(session.state))) throw new Error(`${source.name} cannot activate effects`);
    activateDuelEffect(session, player, uid, effectId, activationHandlers);
  },
  passChain,
  passAttack: (state, player) => passAttackResponseWindow(state, player, battleContinuationHandlers),
  passDamage: (state, player) => passDamageResponseWindow(state, player, battleContinuationHandlers),
  replayAttack: (state, player, attackerUid, targetUid) => replayCoreDuelAttack(state, player, attackerUid, targetUid, coreBattleHandlers),
  cancelAttack: cancelReplayAttack,
  resolvePrompt: resolveDuelPrompt,
  activateTrigger(session, player, triggerId) {
    activateDuelPendingTrigger(session, player, triggerId, activationHandlers);
  },
  declineTrigger(session, player, triggerId) {
    declineDuelPendingTrigger(session, player, triggerId);
    continueAttackResponseWindow(session.state, battleContinuationHandlers);
  },
  flipSummon: flipSummonDuelCard,
  changePosition: (state, player, uid, position) => changeDuelCardPosition(state, player, uid, position, "manual"),
  declareAttack: declareDuelAttack,
  changePhase(state, player, phase) {
    changeDuelPhase(state, player, phase, {
      collectEvent: (eventName, eventCode) => collectDuelTriggerEffects(state, eventName, undefined, eventCode === undefined ? {} : { eventCode }),
      canEnterPhase: (reachedPhase) => canEnterDuelPhase(state, player, reachedPhase),
      executePhaseEffects: (reachedPhase) => executeContinuousPhaseEffects(state, reachedPhase),
    });
  },
  endTurn(state, player) {
    endDuelTurn(state, player, {
      collectEvent: (eventName, eventCode) =>
        collectDuelTriggerEffects(state, eventName, undefined, {
          ...(eventCode === undefined ? {} : { eventCode }),
          ...(eventName === "preDraw" ? { eventPlayer: state.turnPlayer, eventValue: state.options.drawPerTurn } : {}),
        }),
      canDraw: (drawPlayer) => !isDrawPrevented(state, drawPlayer, createContinuousEffectContext(state)),
      canLoseByDeck: (drawPlayer) => !isDeckLossDefeatPrevented(state, drawPlayer, createContinuousEffectContext(state)),
      executePhaseEffects: (reachedPhase) => executeContinuousPhaseEffects(state, reachedPhase),
    });
  },
};

export function registerEffect(session: DuelSession, effect: DuelEffectDefinition): void {
  session.state.effects.push(effect);
}

export function getLegalActions(session: DuelSession, player: PlayerId): DuelAction[] {
  const { state } = session;
  if (state.status !== "awaiting" || state.waitingFor !== player) return [];
  const actions: DuelAction[] = [];
  if (state.prompt) {
    actions.push(...getPromptResponseActions(state.prompt, player));
    return stampDuelActions(actions, state.actionWindowId, "prompt");
  }
  if (state.chain.length) {
    if (!chainLinksResolvable(state)) return stampDuelActions(actions, state.actionWindowId, "chainResponse");
    actions.push(...getChainResponseActions(state, player));
    return stampDuelActions(actions, state.actionWindowId, "chainResponse");
  }
  if (state.pendingTriggers.length) {
    actions.push(...getPendingTriggerActions(state, player));
    return stampDuelActions(actions, state.actionWindowId, "triggerBucket");
  }
  if (state.pendingBattle) {
    actions.push(...battleWindowActions(state, player, quickEffectActions, (duelState, actionPlayer) => coreReplayAttackActions(duelState, actionPlayer, coreBattleHandlers)));
    return stampDuelActions(actions, state.actionWindowId, "battle");
  }
  const hand = getCards(state, player, "hand");
  if (state.phase === "main1" || state.phase === "main2") {
    actions.push(...normalSummonActions(state, player, hand, () => isNoTributeSummonAllowed(state, player)).filter((action) => {
      if (action.type !== "normalSummon" && action.type !== "setMonster") return true;
      const card = findCard(state, action.uid);
      if (!card) return false;
      if (action.type === "normalSummon") return !isNormalSummonPrevented(state, player, card, createContinuousEffectContext(state));
      if (action.type === "setMonster") return !isMonsterSetPrevented(state, player, card, createContinuousEffectContext(state));
      return true;
    }));
    actions.push(...tributeSummonActions(state, player, hand, createReleasePredicate(state, duelReason.release | duelReason.summon)).filter((action) => {
      if (action.type !== "tributeSummon") return true;
      const card = findCard(state, action.uid);
      return Boolean(card && !isNormalSummonPrevented(state, player, card, createContinuousEffectContext(state)));
    }));
    actions.push(...fusionSummonActions(state, player, createMaterialUsePredicate(state, "fusion")));
    actions.push(...synchroSummonActions(state, player, createMaterialUsePredicate(state, "synchro")));
    actions.push(...xyzSummonActions(state, player, (uid) => !isMaterialUsePrevented(state, uid, "xyz", createContinuousEffectContext(state))));
    actions.push(...linkSummonActions(state, player, createMaterialUsePredicate(state, "link")));
    actions.push(...ritualSummonActions(state, player, hand, createMaterialUsePredicate(state, "ritual")));
    actions.push(...specialSummonProcedureActions(state, player));
    if (hasZoneSpace(state, player, "spellTrapZone")) {
      for (const card of hand.filter((candidate) => candidate.kind === "spell" || candidate.kind === "trap")) {
        if (isSpellTrapSetPrevented(state, player, card, createContinuousEffectContext(state))) continue;
        actions.push({ type: "setSpellTrap", player, uid: card.uid, label: `Set ${card.name}` });
      }
    }
    for (const effect of state.effects) {
      if (effect.controller !== player) continue;
      if (effect.event !== "ignition" && effect.event !== "quick") continue;
      const source = findCard(state, effect.sourceUid);
      if (!source || !effect.range.includes(source.location)) continue;
      if (!canUseEffectCount(state, effect)) continue;
      if (!canChooseEffect(state, effect, source, player)) continue;
      actions.push({ type: "activateEffect", player, uid: source.uid, effectId: effect.id, label: `${source.name}: ${effect.id}` });
    }
    actions.push(...corePositionChangeActions(state, player, coreBattleHandlers));
    actions.push(...flipSummonActions(state, player).filter((action) => {
      if (action.type !== "flipSummon") return false;
      const card = findCard(state, action.uid);
      return Boolean(card && !isFlipSummonPrevented(state, card, createContinuousEffectContext(state)));
    }));
  }
  appendBattleActions(actions, state, player, coreBattleHandlers);
  const mustAttack = hasCoreMustAttackAction(state, player, actions, coreBattleHandlers);
  const nextPhase = nextAvailableDuelPhase(state, player, (phase) => canEnterDuelPhase(state, player, phase));
  if (!mustAttack && nextPhase) actions.push({ type: "changePhase", player, phase: nextPhase, label: `Go to ${nextPhase}` });
  if (!mustAttack) actions.push({ type: "endTurn", player, label: "End turn" });
  return stampDuelActions(actions, state.actionWindowId, "open");
}

export function getGroupedDuelLegalActions(session: DuelSession, player: PlayerId): ReturnType<typeof groupDuelLegalActions> {
  return groupDuelLegalActions(getLegalActions(session, player));
}

export function applyResponse(session: DuelSession, response: unknown): ApplyDuelResponseResult {
  return applyDuelResponse(session, response, responseHandlers);
}

export function runScriptedDuelResponses(session: DuelSession, steps: ScriptedResponseSelector[]): ScriptedDuelRunResult {
  return runScriptedDuelResponsesWithHandlers(session, steps, { getLegalActions, applyResponse });
}

export function specialSummonDuelCard(state: DuelState, uid: string, controller?: PlayerId): DuelCardInstance {
  const card = findCard(state, uid);
  if (!card) throw new Error(`Card ${uid} is not in the duel`);
  const summonController = controller ?? card.controller;
  requireZoneSpace(state, summonController, "monsterZone");
  if (!canSpecialSummonDuelCard(state, uid, summonController)) throw new Error(`${card.name} cannot be Special Summoned`);
  collectTriggerEffects(state, "specialSummoning", card);
  moveDuelCard(state, uid, "monsterZone", summonController, duelReason.summon | duelReason.specialSummon);
  card.position = "faceUpAttack";
  card.faceUp = true;
  card.summonType = "special";
  card.summonPlayer = summonController;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [];
  recordSpecialSummonActivity(state, summonController, card);
  pushDuelLog(state, "specialSummon", card.controller, card.name, "Special Summoned");
  collectTriggerEffects(state, "specialSummoned", card);
  return card;
}

export function canSpecialSummonDuelCard(state: DuelState, uid: string, controller?: PlayerId): boolean {
  const card = findCard(state, uid);
  if (!card || !isDuelMonsterLike(card)) return false;
  const summonController = controller ?? card.controller;
  if (isSpecialSummonPrevented(state, summonController, createContinuousEffectContext(state), card)) return false;
  if (!hasZoneSpace(state, summonController, "monsterZone")) return false;
  if (card.location === "extraDeck" && !isFaceUpPendulumExtraDeckCard(card)) return false;
  return canMoveDuelCardToLocation(state, uid, "monsterZone");
}

function canAttemptSpecialSummonProcedure(state: DuelState, uid: string): boolean {
  const card = findCard(state, uid);
  if (!card || !isDuelMonsterLike(card)) return false;
  if (isSpecialSummonPrevented(state, card.controller, createContinuousEffectContext(state), card)) return false;
  if (card.location === "extraDeck" && !isFaceUpPendulumExtraDeckCard(card)) return false;
  return canMoveDuelCardToLocation(state, uid, "monsterZone");
}

export function canPlayerSpecialSummon(state: DuelState, player: PlayerId, card?: DuelCardInstance): boolean {
  return !isSpecialSummonPrevented(state, player, createContinuousEffectContext(state), card);
}

export function canMoveDuelCardToLocation(state: DuelState, uid: string, to: DuelLocation, reason: number = duelReason.effect): boolean {
  if (!canMoveDuelCardToLocationRule(state, uid, to)) return false;
  if ((reason & duelReason.release) !== 0 && isReleasePrevented(state, uid, reason, createContinuousEffectContext(state))) return false;
  return !isMoveToLocationPrevented(state, uid, to, reason, createContinuousEffectContext(state));
}

function requireDuelMoveAllowed(state: DuelState, uid: string, to: DuelLocation, reason: number): void {
  if (!canMoveDuelCardToLocation(state, uid, to, reason)) throw new Error(`Card ${uid} cannot move to ${to}`);
}

export function sendDuelCardToGraveyard(state: DuelState, uid: string, controller?: PlayerId, reason: number = duelReason.effect, reasonPlayer?: PlayerId): DuelCardInstance {
  return sendCoreDuelCardToGraveyard(state, uid, controller, reason, reasonPlayer, coreMovementHandlers);
}

export function destroyDuelCard(state: DuelState, uid: string, controller?: PlayerId, reason: number = duelReason.effect | duelReason.destroy, reasonPlayer?: PlayerId): DuelCardInstance {
  return destroyCoreDuelCard(state, uid, controller, reason, reasonPlayer, coreMovementHandlers);
}

export function banishDuelCard(state: DuelState, uid: string, controller?: PlayerId, reason: number = duelReason.effect, reasonPlayer?: PlayerId): DuelCardInstance {
  return banishCoreDuelCard(state, uid, controller, reason, reasonPlayer, coreMovementHandlers);
}

export function moveDuelCardWithRedirects(state: DuelState, uid: string, to: DuelLocation, controller?: PlayerId, reason: number = duelReason.effect, reasonPlayer?: PlayerId): DuelCardInstance {
  return moveCoreDuelCardWithRedirects(state, uid, to, controller, reason, reasonPlayer, coreMovementHandlers);
}

export function detachDuelOverlayMaterials(state: DuelState, uid: string, count: number, controller?: PlayerId, reason: number = duelReason.cost): DuelCardInstance[] {
  return detachCoreDuelOverlayMaterials(state, uid, count, controller, reason, coreMovementHandlers);
}

export function raiseDuelEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void {
  collectTriggerEffects(state, eventName, eventCard);
}

interface DuelEventPayload {
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  relatedEffectId?: number;
}

export function raiseDuelEventWithCode(state: DuelState, eventName: DuelEventName, eventCode: number, eventCard?: DuelCardInstance, payload: DuelEventPayload = {}): void {
  collectDuelTriggerEffects(state, eventName, eventCard, { eventCode, ...payload });
}

export function setDuelAttackCostPaid(state: DuelState, status: number): number {
  return setDuelAttackCostPaidRule(state, status);
}

export function getDuelAttackCostPaid(state: DuelState): number {
  return getDuelAttackCostPaidRule(state);
}

export function tributeSummonDuelCard(state: DuelState, player: PlayerId, uid: string, tributeUids: string[]): void {
  const card = findCard(state, uid);
  if (card && isNormalSummonPrevented(state, player, card, createContinuousEffectContext(state))) throw new Error(`${card.name} cannot be Tribute Summoned`);
  tributeSummonDuelCardWithEvents(
    state,
    player,
    uid,
    tributeUids,
    (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard),
    createMaterialMover(state),
    createReleasePredicate(state, duelReason.release | duelReason.summon),
  );
}

export function flipSummonDuelCard(state: DuelState, player: PlayerId, uid: string): DuelCardInstance {
  const card = findCard(state, uid);
  if (card && isFlipSummonPrevented(state, card, createContinuousEffectContext(state))) throw new Error(`${card.name} cannot be Flip Summoned`);
  return flipSummonDuelCardWithEvents(state, player, uid, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
}

export function fusionSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return fusionSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createMaterialMover(state), createMaterialUsePredicate(state, "fusion"));
}

export function synchroSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return synchroSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createMaterialMover(state), createMaterialUsePredicate(state, "synchro"));
}

export function xyzSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return xyzSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createOverlayMaterialMover(state));
}

export function linkSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return linkSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createMaterialMover(state), createMaterialUsePredicate(state, "link"));
}

export function ritualSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  return ritualSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createMaterialMover(state), createMaterialUsePredicate(state, "ritual"));
}

function createMaterialMover(state: DuelState): DuelMaterialMover {
  return (uid, controller, reason) => {
    const card = sendDuelCardToGraveyard(state, uid, controller, reason);
    return { card, collectedSentToGraveyard: card.location === "graveyard" };
  };
}

function createOverlayMaterialMover(state: DuelState): DuelOverlayMaterialMover {
  return (uid, controller, reason) => {
    if (isMaterialUsePrevented(state, uid, "xyz", createContinuousEffectContext(state))) throw new Error(`Card ${uid} cannot be used as Xyz material`);
    requireDuelMoveAllowed(state, uid, "overlay", reason);
    return moveDuelCard(state, uid, "overlay", controller, reason);
  };
}

function createMaterialUsePredicate(state: DuelState, kind: "fusion" | "synchro" | "xyz" | "link" | "ritual"): DuelMaterialPredicate {
  return (uid) => !isMaterialUsePrevented(state, uid, kind, createContinuousEffectContext(state));
}

function createReleasePredicate(state: DuelState, reason: number): DuelMaterialPredicate {
  return (uid) => !isReleasePrevented(state, uid, reason, createContinuousEffectContext(state));
}

export function drawDuelCards(state: DuelState, player: PlayerId, count: number, detail = "Effect draw"): number {
  if (!canDuelPlayerDraw(state, player, count)) return 0;
  const drawn = drawDuelCardsFromDeck(state, player, Math.max(0, count), detail);
  if (drawn > 0) collectDuelTriggerEffects(state, "cardsDrawn", undefined, { eventPlayer: player, eventValue: drawn });
  return drawn;
}

export function canDuelPlayerDraw(state: DuelState, player: PlayerId, count = 1): boolean {
  const drawCount = Math.max(0, count);
  if (isDrawPrevented(state, player, createContinuousEffectContext(state))) return false;
  return getCards(state, player, "deck").length >= drawCount;
}

export function canDuelPlayerDiscardDeck(state: DuelState, player: PlayerId, count = 1): boolean {
  const discardCount = Math.max(0, count);
  if (isDeckDiscardPrevented(state, player, createContinuousEffectContext(state))) return false;
  return getCards(state, player, "deck").length >= discardCount;
}

export function canDuelPlayerDiscardHand(state: DuelState, player: PlayerId, count = 1): boolean {
  const discardCount = Math.max(0, count);
  if (isHandDiscardPrevented(state, player, createContinuousEffectContext(state))) return false;
  return getCards(state, player, "hand").length >= discardCount;
}

export function canDuelCardAttack(state: DuelState, uid: string, extraAttackAllowance = 0): boolean {
  return canCoreDuelCardAttack(state, uid, coreBattleHandlers, extraAttackAllowance);
}

export function getDuelAttackTargets(state: DuelState, attackerUid: string): DuelCardInstance[] {
  return getCoreDuelAttackTargets(state, attackerUid, coreBattleHandlers);
}

export function declareDuelAttack(state: DuelState, player: PlayerId, attackerUid: string, targetUid?: string): void {
  declareCoreDuelAttack(state, player, attackerUid, targetUid, coreBattleHandlers);
}

export function negateDuelAttack(state: DuelState): boolean {
  const disabled = negateCoreDuelAttack(state);
  if (disabled) collectTriggerEffects(state, "attackDisabled");
  return disabled;
}

export function canChangeDuelCardPosition(state: DuelState, uid: string, position: CardPosition, source: "effect" | "manual" = "effect"): boolean {
  return canCoreChangeDuelCardPosition(state, uid, position, coreBattleHandlers, source);
}

export function changeDuelCardPosition(state: DuelState, player: PlayerId, uid: string, position: CardPosition, source: "effect" | "manual" = "effect"): DuelCardInstance {
  return changeCoreDuelCardPosition(state, player, uid, position, coreBattleHandlers, source);
}

function createEffectContext(
  state: DuelState,
  source: DuelCardInstance,
  player: PlayerId,
  eventName?: DuelEventName,
  eventCard?: DuelCardInstance,
  targetUids: string[] = [],
  checkOnly = false,
  activationLocation: DuelLocation = source.location,
  activationSequence: number = source.sequence,
  targetPlayer?: PlayerId,
  targetParam?: number,
  chainLink?: ChainLink,
  eventCode?: number,
  eventPlayer?: PlayerId,
  eventValue?: number,
  eventReason?: number,
  eventReasonPlayer?: PlayerId,
  relatedEffectId?: number,
): DuelEffectContext {
  const ctx: DuelEffectContext = {
    duel: state,
    source,
    player,
    activationLocation,
    activationSequence,
    ...(eventName === undefined ? {} : { eventName }),
    ...(eventCode === undefined ? {} : { eventCode }),
    ...(eventPlayer === undefined ? {} : { eventPlayer }),
    ...(eventValue === undefined ? {} : { eventValue }),
    ...(eventReason === undefined ? {} : { eventReason }),
    ...(eventReasonPlayer === undefined ? {} : { eventReasonPlayer }),
    ...(relatedEffectId === undefined ? {} : { relatedEffectId }),
    ...(eventCard === undefined ? {} : { eventCard }),
    ...(checkOnly ? { checkOnly } : {}),
    targetUids,
    ...(targetPlayer === undefined ? {} : { targetPlayer }),
    ...(targetParam === undefined ? {} : { targetParam }),
    ...(chainLink === undefined ? {} : { chainLink }),
    log(detail) {
      pushDuelLog(state, "effect", player, source.name, detail);
    },
    moveCard(uid, to, controller) {
      return moveDuelCard(state, uid, to, controller, duelReason.effect);
    },
    negateChainLink(chainLinkId) {
      return negateDuelChainLink(state, chainLinkId, player, source.name);
    },
    setTargets(uids) {
      targetUids.splice(0, targetUids.length, ...uids);
    },
    getTargets() {
      return targetUids.map((uid) => findCard(state, uid)).filter((card): card is DuelCardInstance => Boolean(card));
    },
    setTargetPlayer(target) {
      ctx.targetPlayer = target;
    },
    setTargetParam(parameter) {
      ctx.targetParam = parameter;
    },
  };
  return ctx;
}

function createContinuousEffectContext(state: DuelState): ContinuousEffectContextFactory {
  return (effect, source, card) => createEffectContext(state, source, effect.controller, undefined, card, [], true);
}

function canEnterDuelPhase(state: DuelState, player: PlayerId, phase: DuelPhase): boolean {
  if (phase !== "battle" && phase !== "main2" && phase !== "end") return true;
  return !isPhaseEntryPrevented(state, player, phase, createContinuousEffectContext(state));
}

function createReplacementEffectHandlers(state: DuelState): ReplacementEffectHandlers {
  return {
    createContinuousContext: createContinuousEffectContext(state),
    createReplacementContext(effect, source, card, checkOnly) {
      return createEffectContext(state, source, effect.controller, undefined, card, [], checkOnly);
    },
    log(action, player, cardName, detail) {
      pushDuelLog(state, action, player, cardName, detail);
    },
  };
}

export function collectDuelTriggerEffects(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance, options: DuelEventPayload & { eventIsLast?: boolean; eventCode?: number } = {}): void {
  const eventCode = options.eventCode ?? duelEventCode(eventName);
  const triggerOptions = eventCode === undefined ? options : { ...options, eventCode };
  recordDuelEvent(state, eventName, eventCard, eventCode, {
    ...(options.eventPlayer === undefined ? {} : { eventPlayer: options.eventPlayer }),
    ...(options.eventValue === undefined ? {} : { eventValue: options.eventValue }),
    ...(options.eventReason === undefined ? {} : { eventReason: options.eventReason }),
    ...(options.eventReasonPlayer === undefined ? {} : { eventReasonPlayer: options.eventReasonPlayer }),
    ...(options.relatedEffectId === undefined ? {} : { relatedEffectId: options.relatedEffectId }),
  });
  collectTriggerEffectsRule(
    state,
    eventName,
    (duel, effect, source, triggerEventName, triggerEventCard) => canChooseEffect(duel, effect, source, effect.controller, triggerEventName, triggerEventCard, options),
    eventCard,
    triggerOptions,
  );
}

function collectTriggerEffects(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void {
  collectDuelTriggerEffects(state, eventName, eventCard);
}

function executeContinuousPhaseEffects(state: DuelState, phase: DuelPhase): void {
  const code = 0x1000 | phaseMask(phase);
  for (const effect of [...state.effects]) {
    if (effect.event !== "continuous" || effect.code !== code || !canUseEffectCount(state, effect)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createEffectContext(state, source, effect.controller, "phaseChanged");
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    effect.operation(ctx);
    markEffectUsed(state, effect);
  }
}

function getChainResponseActions(state: DuelState, player: PlayerId): DuelAction[] {
  const actions = quickEffectActions(state, player);
  actions.push({ type: "passChain", player, label: "Pass" });
  return actions;
}

function chainLinksResolvable(state: DuelState): boolean {
  return state.chain.every((link) => {
    const effect = state.effects.find((candidate) => candidate.id === link.effectId && candidate.sourceUid === link.sourceUid);
    return Boolean(effect && findCard(state, link.sourceUid));
  });
}

function quickEffectActions(state: DuelState, player: PlayerId): DuelAction[] {
  return getQuickEffectActions(state, player, canChooseEffect);
}

function specialSummonProcedureActions(state: DuelState, player: PlayerId): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const effect of state.effects) {
    if (effect.controller !== player || effect.event !== "summonProcedure") continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!canUseEffectCount(state, effect)) continue;
    if (!canAttemptSpecialSummonProcedure(state, source.uid)) continue;
    if (!canChooseEffect(state, effect, source, player)) continue;
    actions.push({ type: "specialSummonProcedure", player, uid: source.uid, effectId: effect.id, label: `Special Summon ${source.name}` });
  }
  return actions;
}

function canChooseEffect(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId, eventName?: DuelEventName, eventCard?: DuelCardInstance, payload: DuelEventPayload = {}): boolean {
  if (isEffectActivationPrevented(state, player, source, createContinuousEffectContext(state))) return false;
  const ctx = createEffectContext(
    state,
    source,
    player,
    eventName,
    eventCard,
    [],
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    payload.eventPlayer,
    payload.eventValue,
    payload.eventReason,
    payload.eventReasonPlayer,
    payload.relatedEffectId,
  );
  if (effect.canActivate && !effect.canActivate(ctx)) return false;
  if (effect.cost && !effect.cost(ctx)) return false;
  if (effect.target && !effect.target(ctx)) return false;
  return true;
}

function hasChainResponses(state: DuelState, player: PlayerId): boolean {
  return hasQuickEffectResponses(state, player, canChooseEffect);
}

export { addDuelChainLimit } from "#duel/chain-limits.js";

function pushChainLink(
  state: DuelState,
  player: PlayerId,
  sourceUid: string,
  effectId: string,
  eventName?: DuelEventName,
  eventCard?: DuelCardInstance,
  targetUids: string[] = [],
  targetPlayer?: PlayerId,
  targetParam?: number,
  eventCode?: number,
  eventPlayer?: PlayerId,
  eventValue?: number,
  eventReason?: number,
  eventReasonPlayer?: PlayerId,
  relatedEffectId?: number,
): void {
  const source = findCard(state, sourceUid);
  state.chain.push({
    id: `chain-${state.log.length + 1}`,
    player,
    sourceUid,
    effectId,
    ...(source === undefined ? {} : { activationLocation: source.location, activationSequence: source.sequence }),
    ...(eventName === undefined ? {} : { eventName }),
    ...(eventCode === undefined ? {} : { eventCode }),
    ...(eventPlayer === undefined ? {} : { eventPlayer }),
    ...(eventValue === undefined ? {} : { eventValue }),
    ...(eventReason === undefined ? {} : { eventReason }),
    ...(eventReasonPlayer === undefined ? {} : { eventReasonPlayer }),
    ...(relatedEffectId === undefined ? {} : { relatedEffectId }),
    ...(eventCard === undefined ? {} : { eventCardUid: eventCard.uid }),
    ...(targetUids.length === 0 ? {} : { targetUids: [...targetUids] }),
    ...(targetPlayer === undefined ? {} : { targetPlayer }),
    ...(targetParam === undefined ? {} : { targetParam }),
  });
  if (source) {
    collectTriggerEffects(state, "chainActivating", source);
    collectDuelTriggerEffects(state, "chaining", source, {
      eventPlayer: player,
      eventValue: state.chain.length,
      eventReasonPlayer: player,
      ...relatedEffectPayload(effectId),
    });
  }
  for (const targetUid of targetUids) {
    const target = findCard(state, targetUid);
    if (target) collectTriggerEffects(state, "becameTarget", target);
  }
  markDuelPhaseActivity(state);
  state.chainPasses = [];
  markBattleWindowChainStarted(state);
  clearStaleChainLimits(state);
}

function relatedEffectPayload(effectId: string): Pick<DuelEventPayload, "relatedEffectId"> {
  const relatedEffectId = Number(effectId.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(relatedEffectId) ? { relatedEffectId } : {};
}

function passChain(state: DuelState, player: PlayerId): void {
  const rollback = captureDuelState(state);
  try {
    if (!state.chain.length) throw new Error("No chain is pending");
    if (!state.chainPasses.includes(player)) state.chainPasses.push(player);
    const nextPlayer = otherPlayer(player);
    if (state.chainPasses.includes(nextPlayer) || !hasChainResponses(state, nextPlayer)) {
      resolveChain(state);
      return;
    }
    state.waitingFor = nextPlayer;
  } catch (error) {
    restoreDuelState(state, rollback);
    throw error;
  }
}

function resolveChain(state: DuelState): void {
  const rollback = captureDuelState(state);
  state.status = "resolving";
  try {
    while (state.chain.length) {
      const link = state.chain.pop();
      if (!link) continue;
      if (link.negated) {
        pushDuelLog(state, "chainNegated", link.player, undefined, link.effectId);
        collectTriggerEffects(state, "chainNegated");
        collectTriggerEffects(state, "chainDisabled");
        continue;
      }
      const effect = state.effects.find((candidate) => candidate.id === link.effectId && candidate.sourceUid === link.sourceUid);
      const source = findCard(state, link.sourceUid);
      if (!effect || !source) continue;
      const eventCard = link.eventCardUid === undefined ? undefined : findCard(state, link.eventCardUid);
      collectTriggerEffects(state, "chainSolving", source);
      const ctx = createEffectContext(
        state,
        source,
        link.player,
        link.eventName,
        eventCard,
        [...(link.targetUids ?? [])],
        false,
        link.activationLocation ?? source.location,
        link.activationSequence ?? source.sequence,
        link.targetPlayer,
        link.targetParam,
        link,
        link.eventCode,
        link.eventPlayer,
        link.eventValue,
        link.eventReason,
        link.eventReasonPlayer,
        link.relatedEffectId,
      );
      (link.operationOverride ?? effect.operation)(ctx);
      collectTriggerEffects(state, "chainSolved");
    }
  } catch (error) {
    restoreDuelState(state, rollback);
    throw error;
  } finally {
    clearChainLimits(state);
  }
  pruneResetEffectsAfterChain(state);
  pruneDuelFlagEffectsAfterChain(state);
  const resolvedStatus = (state as { status: DuelStatus }).status;
  if (resolvedStatus === "ended") return;
  state.chainPasses = [];
  state.status = "awaiting";
  if (state.pendingTriggers.length === 0) collectTriggerEffects(state, "chainEnded");
  state.waitingFor = state.pendingTriggers[0]?.player ?? state.turnPlayer;
  continueAttackResponseWindow(state, battleContinuationHandlers);
}

export function negateDuelChainLink(state: DuelState, chainLinkId: string, player: PlayerId, cardName: string): boolean {
  const link = state.chain.find((candidate) => candidate.id === chainLinkId);
  if (!link || !canNegateDuelChainLink(state, chainLinkId)) return false;
  link.negated = true;
  link.disableReason = duelReason.effect;
  link.disablePlayer = player;
  pushDuelLog(state, "negate", player, cardName, link.effectId);
  return true;
}

export function canNegateDuelChainLink(state: DuelState, chainLinkId: string): boolean {
  const link = state.chain.find((candidate) => candidate.id === chainLinkId);
  if (!link || link.negated) return false;
  const source = findCard(state, link.sourceUid);
  return !source || !isChainLinkNegationPrevented(state, source, createContinuousEffectContext(state));
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
