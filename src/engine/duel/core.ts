import { markDuelPhaseActivity, recordChainActivity, recordSpecialSummonActivity } from "#duel/activity.js";
import { clearChainLimits, clearStaleChainLimits } from "#duel/chain-limits.js";
import { collectDeferredChainEndedAfterDecline } from "#duel/chain-lifecycle.js";
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
import { pendulumSummonActions, pendulumSummonDuelCards as pendulumSummonDuelCardsWithHooks } from "#duel/pendulum-summon.js";
import { isNoTributeSummonAllowed } from "#duel/no-tribute.js";
import {
  flipSummonActions,
  flipSummonDuelCard as flipSummonDuelCardWithEvents,
  fusionSummonActions,
  fusionSummonDuelCard as fusionSummonDuelCardWithEvents,
  geminiNormalSummonActions,
  linkSummonActions,
  linkSummonDuelCard as linkSummonDuelCardWithEvents,
  normalSummon,
  normalSummonActions,
  ritualSummonActions,
  ritualSummonDuelCard as ritualSummonDuelCardWithEvents,
  setMonster,
  synchroSummonActions,
  synchroSummonDuelCard as synchroSummonDuelCardWithEvents,
  tributeSetActions,
  tributeSetDuelCard as tributeSetDuelCardWithEvents,
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
  finishDuelPendingTriggerSelection,
  normalSummonDuelByProcedure,
  shouldContinueTriggerSelection,
  specialSummonDuelByProcedure,
  type DuelActivationHandlers,
} from "#duel/effect-activation.js";
import { captureDuelState, restoreDuelState } from "#duel/state-rollback.js";
import { applyActivationCosts } from "#duel/activation-cost.js";
import { setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";
import {
  cancelReplayAttack,
  getDuelAttackCostPaid as getDuelAttackCostPaidRule,
  recordBattledPair,
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
  getCoreDuelAttackableTargets,
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
import { resolvePendingBattle, type BattleContinuationHandlers } from "#duel/battle-continuation.js";
import {
  isDrawPrevented,
  isCardDisabled,
  continuousEffectSourceIsActive,
  isDeckDiscardPrevented,
  isDeckLossDefeatPrevented,
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
import { executeContinuousEventEffects, executeNonChainSolvingContinuousEventEffects } from "#duel/continuous-event-effects.js";
import { isTurnSkipped } from "#duel/skip-turn.js";
export { canNegateDuelChainLink, canNegateDuelChainLinkObject, negateDuelChainLink, negateDuelChainLinkObject } from "#duel/chain-negation.js";
import { chainLinksResolvable } from "#duel/chain-state.js";
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
import { createEffectContext } from "#duel/effect-context.js";
import { quickEffectEventContext } from "#duel/effect-event-context.js";
import { eventCardStatePayload, relatedEffectPayload, type DuelEventPayload } from "#duel/event-history.js";
import { pruneResetEffectsAfterChain, pruneResetEffectsAfterDisable } from "#duel/effect-reset.js";
import { pruneDuelFlagEffectsAfterChain, pruneDuelFlagEffectsAfterDisable } from "#duel/flags.js";
import { collectDuelGroupedTriggerEffectsWithChooser } from "#duel/grouped-trigger-events.js";
import type { ReplacementEffectHandlers } from "#duel/replacement-effects.js";
import { getPendingTriggerActions } from "#duel/pending-trigger-actions.js";
import { groupDuelLegalActions } from "#duel/legal-action-groups.js";
import { hasPendingLuaOperationPrompt, setPendingLuaOperationPrompt, resolvePendingLuaOperationPrompt } from "#duel/lua-operation-prompt.js";
export { groupDuelLegalActions } from "#duel/legal-action-groups.js";
export type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
export { describeDuelActionSelector, duelActionMatchesSelector, selectDuelActionBySelector } from "#duel/action-selectors.js";
import { phaseMask } from "#duel/phase-mask.js";
import { otherPlayer } from "#duel/player-id.js";
import { damageDuelPlayer, recoverDuelPlayer, setDuelPlayerLifePoints } from "#duel/player-life.js";
import { getPromptResponseActions, resolveDuelPrompt, stampDuelActions } from "#duel/prompt-response.js";
import { applyYieldedLuaPromptToDuelState, isYieldedLuaPromptCoroutineResult } from "#lua/prompt-state.js";
import { hasQuickEffectResponses, quickEffectActions as getQuickEffectActions } from "#duel/quick-effect-actions.js";
import { applyDuelResponse, type DuelResponseHandlers } from "#duel/response-dispatch.js";
import { runScriptedDuelResponses as runScriptedDuelResponsesWithHandlers } from "#duel/scripted-runner.js";
import { applyContinuousSelfDestroyEffects } from "#duel/self-destroy-effects.js";
import { setSpellTrap } from "#duel/spell-trap.js";
import { canActivateSpellTrapCardEffect, shouldSendActivatedSpellTrapToGraveyard } from "#duel/spell-trap-activation.js";
import { applySpecialSummonCosts } from "#duel/special-summon-cost.js";
import { negateCoreDuelSummon } from "#duel/summon-negation.js";
import { hasLuaLimitNormalSummonProcedure, luaLimitNormalSummonProcedureValue, normalSummonProcedureActions, specialSummonProcedureActions } from "#duel/summon-procedure-actions.js";
import { applySummonOrSetCosts } from "#duel/summon-set-cost.js";
import { duelSummonTypeFromCode, isFaceDownExtraDeckSummonTypeCode, luaSummonTypeFusion, luaSummonTypeLink, luaSummonTypePendulum, luaSummonTypeRitual, luaSummonTypeSynchro, luaSummonTypeXyz } from "#duel/summon-type-codes.js";
import { changeDuelPhase, drawDuelCardsFromDeck, endDuelTurn, isDuelPhaseSkipped, nextAvailableDuelPhase } from "#duel/turn-flow.js";
import { isLuaOptionPromptDecision, type LuaPromptCoroutineResult } from "#lua/host-types.js";
export { createDuel, loadDecks, startDuel, type CreateDuelOptions } from "#duel/setup.js";
import type {
  ApplyDuelResponseResult,
  CardPosition,
  ChainLink,
  DuelAction,
  DuelCardInstance,
  DuelEffectDefinition,
  DuelEventCardState,
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
  canSpecialSummonCard: (state, uid, player, summonTypeCode, allowUnconditionalSpecialSummonCondition, relatedEffectId, summonPosition) => canSpecialSummonDuelCard(state, uid, player, summonTypeCode, relatedEffectId, allowUnconditionalSpecialSummonCondition, summonPosition),
  specialSummonCard: (state, uid, player, summonTypeCode, allowUnconditionalSpecialSummonCondition, relatedEffectId, summonPosition) => specialSummonDuelCard(state, uid, player, undefined, {}, summonTypeCode, true, allowUnconditionalSpecialSummonCondition, summonPosition, relatedEffectId),
};
const battleContinuationHandlers: BattleContinuationHandlers = {
  additionalBattleDamagePlayers: (state, player, battleCards) => getCoreAdditionalBattleDamagePlayers(state, player, battleCards, coreBattleHandlers),
  battleDamagePlayer: (state, player, battleCards) => reflectedDuelBattleDamagePlayerRule(state, player, createContinuousEffectContext(state), battleCards),
  battleDamageReason: (state, player, battleCards) => getCoreBattleDamageReason(state, player, battleCards, coreBattleHandlers),
  canAttackTarget: (state, attacker, target) => canCoreAttackTarget(state, attacker, target, coreBattleHandlers),
  collectEvent: collectBattleEvent,
  changeBattleDamage: (state, player, amount, battleCards, options) => changeDuelBattleDamageWithPreventionRule(state, player, amount, createContinuousEffectContext(state), battleCards, options),
  damagePlayer: damageDuelPlayer,
  destroyCard: destroyDuelCard,
  getAttackValue: (state, card) => getCoreBattleAttackValue(state, card, coreBattleHandlers),
  getDefenseValue: (state, card) => getCoreBattleDefenseValue(state, card, coreBattleHandlers),
  hasPiercingDamage: (state, card) => hasCorePiercingBattleDamage(state, card, coreBattleHandlers),
};

const coreBattleHandlers: CoreBattleHandlers = {
  additionalBattleDamagePlayers: (state, player, battleCards) => getCoreAdditionalBattleDamagePlayers(state, player, battleCards, coreBattleHandlers),
  battleDamagePlayer: (state, player, battleCards) => reflectedDuelBattleDamagePlayerRule(state, player, createContinuousEffectContext(state), battleCards),
  battleDamageReason: (state, player, battleCards) => getCoreBattleDamageReason(state, player, battleCards, coreBattleHandlers),
  collectEvent: collectBattleEvent,
  changeBattleDamage: (state, player, amount, battleCards, options) => changeDuelBattleDamageWithPreventionRule(state, player, amount, createContinuousEffectContext(state), battleCards, options),
  createContinuousContext: createContinuousEffectContext,
  damagePlayer: damageDuelPlayer,
  destroyCard: destroyDuelCard,
  getAttackValue: (state, card) => getCoreBattleAttackValue(state, card, coreBattleHandlers),
  getDefenseValue: (state, card) => getCoreBattleDefenseValue(state, card, coreBattleHandlers),
  hasPiercingDamage: (state, card) => hasCorePiercingBattleDamage(state, card, coreBattleHandlers),
};

const coreMovementHandlers: CoreMovementHandlers = {
  canMoveCardToLocation: canMoveDuelCardToLocation,
  collectTrigger: (state, eventName, eventCard, options) => collectTriggerEffects(state, eventName, eventCard, options),
  createContinuousContext: createContinuousEffectContext,
  createReplacementHandlers: createReplacementEffectHandlers,
};

const responseHandlers: DuelResponseHandlers = {
  getLegalActions,
  normalSummon(state, player, uid) {
    const card = findCard(state, uid);
    if (card && isNormalSummonPrevented(state, player, card, createContinuousEffectContext(state))) throw new Error(`${card.name} cannot be Normal Summoned`);
    if (card) paySummonOrSetCosts(state, player, card, [91]);
    normalSummon(state, player, uid, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), () => isNoTributeSummonAllowed(state, player));
  },
  tributeSummon(session, player, uid, tributeUids, effectId) {
    if (effectId !== undefined) {
      const card = findCard(session.state, uid);
      if (card) paySummonOrSetCosts(session.state, player, card, [91]);
      normalSummonDuelByProcedure(session.state, player, uid, effectId, (eventName, eventCard) => collectTriggerEffects(session.state, eventName, eventCard));
      return;
    }
    tributeSummonDuelCard(session.state, player, uid, tributeUids);
  },
  tributeSet: tributeSetDuelCard,
  fusionSummon: fusionSummonDuelCard,
  synchroSummon: synchroSummonDuelCard,
  xyzSummon: xyzSummonDuelCard,
  linkSummon: linkSummonDuelCard,
  ritualSummon: ritualSummonDuelCard,
  pendulumSummon: pendulumSummonDuelCards,
  specialSummonProcedure(session, player, uid, effectId) {
    specialSummonDuelByProcedure(session, player, uid, effectId, activationHandlers);
  },
  setMonster(state, player, uid) {
    const card = findCard(state, uid);
    if (card && isMonsterSetPrevented(state, player, card, createContinuousEffectContext(state))) throw new Error(`${card.name} cannot be Set`);
    if (card) paySummonOrSetCosts(state, player, card, [94]);
    setMonster(state, player, uid, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
  },
  setSpellTrap(state, player, uid) {
    const card = findCard(state, uid);
    if (card && isSpellTrapSetPrevented(state, player, card, createContinuousEffectContext(state))) throw new Error(`${card.name} cannot be Set`);
    if (card) paySummonOrSetCosts(state, player, card, [95]);
    setSpellTrap(state, player, uid, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
  },
  activateEffect(session, player, uid, effectId) {
    const source = findCard(session.state, uid);
    const effect = session.state.effects.find((candidate) => candidate.id === effectId && candidate.sourceUid === uid);
    if (source && isEffectActivationPrevented(session.state, player, source, createContinuousEffectContext(session.state), effect)) throw new Error(`${source.name} cannot activate effects`);
    if (source) applyActivationCosts(session.state, player, createContinuousEffectContext(session.state), source, effect);
    activateDuelEffect(session, player, uid, effectId, activationHandlers);
  },
  passChain,
  passAttack: (state, player) => passAttackResponseWindow(state, player, battleContinuationHandlers),
  passDamage: (state, player) => passDamageResponseWindow(state, player, battleContinuationHandlers),
  replayAttack: (state, player, attackerUid, targetUid) => replayCoreDuelAttack(state, player, attackerUid, targetUid, coreBattleHandlers),
  cancelAttack: cancelReplayAttack,
  resolvePrompt(session, response) {
    if (resolvePendingLuaOperationPrompt(session.state, response)) return;
    resolveDuelPrompt(session.state, response);
  },
  activateTrigger(session, response) {
    activateDuelPendingTrigger(session, response.player, response.triggerId, response.triggerBucket, activationHandlers);
  },
  declineTrigger(session, response) {
    const declinedTrigger = declineDuelPendingTrigger(session, response.player, response.triggerId, response.triggerBucket);
    finishDuelPendingTriggerSelection(session, activationHandlers);
    collectDeferredChainEndedAfterDecline(session.state, declinedTrigger, () => collectTriggerEffects(session.state, "chainEnded"));
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
  const disabledBefore = effect.event === "continuous" && effect.code === 2 ? disabledCardUids(session.state) : undefined;
  session.state.effects.push(effect);
  if (disabledBefore) pruneNewlyDisabledCardResets(session.state, disabledBefore, effect.id);
}

function disabledCardUids(state: DuelState): Set<string> {
  const createContext = createContinuousEffectContext(state);
  return new Set(state.cards.filter((card) => isCardDisabled(state, card, createContext)).map((card) => card.uid));
}

function pruneNewlyDisabledCardResets(state: DuelState, disabledBefore: Set<string>, ignoredEffectId: string): void {
  const createContext = createContinuousEffectContext(state);
  for (const card of state.cards) {
    if (disabledBefore.has(card.uid) || !isCardDisabled(state, card, createContext)) continue;
    pruneResetEffectsAfterDisable(state, card, ignoredEffectId);
    pruneDuelFlagEffectsAfterDisable(state, card);
  }
}

export function getLegalActions(session: DuelSession, player: PlayerId): DuelAction[] {
  const { state } = session;
  if (state.status !== "awaiting" || state.waitingFor !== player) return [];
  const actions: DuelAction[] = [];
  if (state.prompt) {
    if (state.prompt.origin === "luaOperation" && !hasPendingLuaOperationPrompt(state)) return stampDuelActions(actions, state.actionWindowId, "prompt", state.actionWindowToken);
    actions.push(...getPromptResponseActions(state.prompt, player));
    return stampDuelActions(actions, state.actionWindowId, "prompt", state.actionWindowToken);
  }
  if (shouldContinueTriggerSelection(state)) {
    actions.push(...getPendingTriggerActions(state, player));
    return stampDuelActions(actions, state.actionWindowId, "triggerBucket", state.actionWindowToken);
  }
  if (state.chain.length) {
    if (!chainLinksResolvable(state)) return stampDuelActions(actions, state.actionWindowId, "chainResponse", state.actionWindowToken);
    actions.push(...getChainResponseActions(state, player));
    return stampDuelActions(actions, state.actionWindowId, "chainResponse", state.actionWindowToken);
  }
  if (state.pendingBattle) {
    actions.push(...battleWindowActions(state, player, quickEffectActions, (duelState, actionPlayer) => coreReplayAttackActions(duelState, actionPlayer, coreBattleHandlers)));
    return stampDuelActions(actions, state.actionWindowId, "battle", state.actionWindowToken);
  }
  const hand = getCards(state, player, "hand");
  if (isTurnSkipped(state, player, createContinuousEffectContext(state))) {
    return stampDuelActions([{ type: "endTurn", player, label: "End turn" }], state.actionWindowId, "open", state.actionWindowToken);
  }
  const currentPhaseSkipped = isDuelPhaseSkipped(state, player, state.phase) || !canEnterDuelPhase(state, player, state.phase);
  if (!currentPhaseSkipped && (state.phase === "main1" || state.phase === "main2")) {
    actions.push(...normalSummonActions(state, player, hand, () => isNoTributeSummonAllowed(state, player)).filter((action) => {
      if (action.type !== "normalSummon" && action.type !== "setMonster") return true;
      const card = findCard(state, action.uid);
      if (!card) return false;
      if (hasLuaLimitNormalSummonProcedure(state, player, card)) return false;
      if (action.type === "normalSummon") return !isNormalSummonPrevented(state, player, card, createContinuousEffectContext(state));
      if (action.type === "setMonster") return !isMonsterSetPrevented(state, player, card, createContinuousEffectContext(state));
      return true;
    }));
    actions.push(...geminiNormalSummonActions(state, player).filter((action) => {
      const card = findCard(state, action.uid);
      return Boolean(card && !isNormalSummonPrevented(state, player, card, createContinuousEffectContext(state)));
    }));
    actions.push(...tributeSummonActions(state, player, hand, createReleasePredicate(state, duelReason.release | duelReason.summon)).filter((action) => {
      if (action.type !== "tributeSummon") return true;
      const card = findCard(state, action.uid);
      return Boolean(card && !hasLuaLimitNormalSummonProcedure(state, player, card) && !isNormalSummonPrevented(state, player, card, createContinuousEffectContext(state)));
    }));
    actions.push(...tributeSetActions(state, player, hand, createReleasePredicate(state, duelReason.release | duelReason.summon)).filter((action) => {
      if (action.type !== "tributeSet") return true;
      const card = findCard(state, action.uid);
      return Boolean(card && !isMonsterSetPrevented(state, player, card, createContinuousEffectContext(state)));
    }));
    actions.push(...normalSummonProcedureActions(state, player, (effect, source, actionPlayer) => canChooseEffect(state, effect, source, actionPlayer), (actionPlayer, card) => !isNormalSummonPrevented(state, actionPlayer, card, createContinuousEffectContext(state))));
    actions.push(...fusionSummonActions(state, player, createMaterialUsePredicate(state, "fusion")).filter((action) => canPerformTypedSpecialSummonAction(state, player, action, luaSummonTypeFusion)));
    actions.push(...synchroSummonActions(state, player, createMaterialUsePredicate(state, "synchro")).filter((action) => canPerformTypedSpecialSummonAction(state, player, action, luaSummonTypeSynchro)));
    actions.push(...xyzSummonActions(state, player, createMaterialUsePredicate(state, "xyz")).filter((action) => canPerformTypedSpecialSummonAction(state, player, action, luaSummonTypeXyz)));
    actions.push(...linkSummonActions(state, player, createMaterialUsePredicate(state, "link")).filter((action) => canPerformTypedSpecialSummonAction(state, player, action, luaSummonTypeLink)));
    actions.push(...ritualSummonActions(state, player, hand, createMaterialUsePredicate(state, "ritual")).filter((action) => canPerformTypedSpecialSummonAction(state, player, action, luaSummonTypeRitual)));
    actions.push(...pendulumSummonActions(state, player, (uid) => canSpecialSummonDuelCard(state, uid, player, luaSummonTypePendulum)));
    actions.push(...specialSummonProcedureActions(state, player, (effect, source, actionPlayer) => canChooseEffect(state, effect, source, actionPlayer), (uid, summonTypeCode) => canAttemptSpecialSummonProcedure(state, uid, summonTypeCode)));
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
    actions.push(...flipSummonActions(state, player).filter((action) => {
      if (action.type !== "flipSummon") return false;
      const card = findCard(state, action.uid);
      return Boolean(card && !isFlipSummonPrevented(state, card, createContinuousEffectContext(state)));
    }));
    actions.push(...corePositionChangeActions(state, player, coreBattleHandlers));
  }
  else if (!currentPhaseSkipped) {
    actions.push(...quickEffectActions(state, player));
  }
  if (!currentPhaseSkipped) appendBattleActions(actions, state, player, coreBattleHandlers);
  const mustAttack = hasCoreMustAttackAction(state, player, actions, coreBattleHandlers);
  const nextPhase = nextAvailableDuelPhase(state, player, (phase) => canEnterDuelPhase(state, player, phase));
  if (!mustAttack && nextPhase) actions.push({ type: "changePhase", player, phase: nextPhase, label: `Go to ${nextPhase}` });
  if (!mustAttack) actions.push({ type: "endTurn", player, label: "End turn" });
  return stampDuelActions(actions, state.actionWindowId, "open", state.actionWindowToken);
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

export function specialSummonDuelCard(state: DuelState, uid: string, controller?: PlayerId, reasonPlayer?: PlayerId, payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}, summonTypeCode?: number, collectSuccess = true, allowUnconditionalSpecialSummonCondition = false, summonPosition?: CardPosition, relatedEffectId?: number): DuelCardInstance {
  const card = findCard(state, uid);
  if (!card) throw new Error(`Card ${uid} is not in the duel`);
  const summonController = controller ?? card.controller;
  requireZoneSpace(state, summonController, "monsterZone");
  if (!canSpecialSummonDuelCard(state, uid, summonController, summonTypeCode, relatedEffectId ?? payload.eventReasonEffectId, allowUnconditionalSpecialSummonCondition, summonPosition)) throw new Error(`${card.name} cannot be Special Summoned`);
  applySpecialSummonCosts(state, summonController, createContinuousEffectContext(state), card, summonTypeCode);
  collectTriggerEffects(state, "specialSummoning", card);
  moveDuelCard(state, uid, "monsterZone", summonController, duelReason.summon | duelReason.specialSummon, reasonPlayer);
  if (payload.eventReasonCardUid !== undefined) card.reasonCardUid = payload.eventReasonCardUid;
  if (payload.eventReasonEffectId !== undefined) card.reasonEffectId = payload.eventReasonEffectId;
  card.position = summonPosition ?? "faceUpAttack";
  card.faceUp = card.position !== "faceDownDefense";
  card.summonType = duelSummonTypeFromCode(summonTypeCode);
  if (summonTypeCode && summonTypeCode !== 0) card.summonTypeCode = summonTypeCode;
  else delete card.summonTypeCode;
  card.summonPlayer = summonController;
  card.summonPhase = state.phase;
  card.summonMaterialUids = [];
  recordSpecialSummonActivity(state, summonController, card);
  pushDuelLog(state, "specialSummon", card.controller, card.name, "Special Summoned");
  if (collectSuccess) collectTriggerEffects(state, "specialSummoned", card);
  return card;
}

export function negateDuelSummon(state: DuelState, uid: string, reasonPlayer: PlayerId = state.turnPlayer, payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): DuelCardInstance | undefined {
  return negateCoreDuelSummon(state, uid, {
    createContinuousContext: createContinuousEffectContext,
    collectEvent: collectDuelTriggerEffects,
  }, reasonPlayer, payload);
}

export function canSpecialSummonDuelCard(state: DuelState, uid: string, controller?: PlayerId, summonTypeCode?: number, relatedEffectId?: number, allowUnconditionalSpecialSummonCondition = false, summonPosition?: CardPosition): boolean {
  const card = findCard(state, uid);
  if (!card || !isDuelMonsterLike(card)) return false;
  const summonController = controller ?? card.controller;
  if (isSpecialSummonPrevented(state, summonController, createContinuousEffectContext(state), card, summonTypeCode, relatedEffectId, allowUnconditionalSpecialSummonCondition, summonPosition)) return false;
  if (!hasZoneSpace(state, summonController, "monsterZone")) return false;
  if (card.location === "extraDeck" && !isFaceUpPendulumExtraDeckCard(card) && !isFaceDownExtraDeckSummonTypeCode(summonTypeCode)) return false;
  return canMoveDuelCardToLocation(state, uid, "monsterZone");
}

function canAttemptSpecialSummonProcedure(state: DuelState, uid: string, summonTypeCode?: number, relatedEffectId?: number): boolean {
  const card = findCard(state, uid);
  if (!card || !isDuelMonsterLike(card)) return false;
  if (isSpecialSummonPrevented(state, card.controller, createContinuousEffectContext(state), card, summonTypeCode, relatedEffectId, true)) return false;
  if (card.location === "extraDeck" && !isFaceUpPendulumExtraDeckCard(card) && !isFaceDownExtraDeckSummonTypeCode(summonTypeCode)) return false;
  return canMoveDuelCardToLocation(state, uid, "monsterZone");
}

export function canPlayerSpecialSummon(state: DuelState, player: PlayerId, card?: DuelCardInstance, summonTypeCode?: number, relatedEffectId?: number, summonPosition?: CardPosition): boolean {
  return !isSpecialSummonPrevented(state, player, createContinuousEffectContext(state), card, summonTypeCode, relatedEffectId, false, summonPosition);
}

export function canMoveDuelCardToLocation(state: DuelState, uid: string, to: DuelLocation, reason: number = duelReason.effect): boolean {
  if (!canMoveDuelCardToLocationRule(state, uid, to)) return false;
  if ((reason & duelReason.release) !== 0 && isReleasePrevented(state, uid, reason, createContinuousEffectContext(state))) return false;
  return !isMoveToLocationPrevented(state, uid, to, reason, createContinuousEffectContext(state));
}

function requireDuelMoveAllowed(state: DuelState, uid: string, to: DuelLocation, reason: number): void {
  if (!canMoveDuelCardToLocation(state, uid, to, reason)) throw new Error(`Card ${uid} cannot move to ${to}`);
}

export function sendDuelCardToGraveyard(state: DuelState, uid: string, controller?: PlayerId, reason: number = duelReason.effect, reasonPlayer?: PlayerId, payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): DuelCardInstance { return sendCoreDuelCardToGraveyard(state, uid, controller, reason, reasonPlayer, coreMovementHandlers, payload); }

export function destroyDuelCard(state: DuelState, uid: string, controller?: PlayerId, reason: number = duelReason.effect | duelReason.destroy, reasonPlayer?: PlayerId, destination: DuelLocation = "graveyard", payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): DuelCardInstance { return destroyCoreDuelCard(state, uid, controller, reason, reasonPlayer, coreMovementHandlers, destination, payload); }

export function banishDuelCard(state: DuelState, uid: string, controller?: PlayerId, reason: number = duelReason.effect, reasonPlayer?: PlayerId, payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): DuelCardInstance { return banishCoreDuelCard(state, uid, controller, reason, reasonPlayer, coreMovementHandlers, payload); }

export function moveDuelCardWithRedirects(state: DuelState, uid: string, to: DuelLocation, controller?: PlayerId, reason: number = duelReason.effect, reasonPlayer?: PlayerId, payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): DuelCardInstance { return moveCoreDuelCardWithRedirects(state, uid, to, controller, reason, reasonPlayer, coreMovementHandlers, payload); }

export function detachDuelOverlayMaterials(state: DuelState, uid: string, count: number, controller?: PlayerId, reason: number = duelReason.cost, reasonPlayer?: PlayerId, payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): DuelCardInstance[] { return detachCoreDuelOverlayMaterials(state, uid, count, controller, reason, coreMovementHandlers, reasonPlayer, payload); }

export function raiseDuelEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void { collectTriggerEffects(state, eventName, eventCard); }

export function raiseDuelEventWithCode(state: DuelState, eventName: DuelEventName, eventCode: number, eventCard?: DuelCardInstance, payload: DuelEventPayload = {}): void { collectDuelTriggerEffects(state, eventName, eventCard, { eventCode, ...payload }); }

export function setDuelAttackCostPaid(state: DuelState, status: number): number { return setDuelAttackCostPaidRule(state, status); }

export function getDuelAttackCostPaid(state: DuelState): number { return getDuelAttackCostPaidRule(state); }

export function tributeSummonDuelCard(state: DuelState, player: PlayerId, uid: string, tributeUids: string[]): void {
  const card = findCard(state, uid);
  if (card && isNormalSummonPrevented(state, player, card, createContinuousEffectContext(state))) throw new Error(`${card.name} cannot be Tribute Summoned`);
  if (card) paySummonOrSetCosts(state, player, card, [91]);
  const summonTypeCode = card ? luaLimitNormalSummonProcedureValue(state, player, card.uid) : undefined;
  tributeSummonDuelCardWithEvents(state, player, uid, tributeUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard),
    createMaterialMover(state), createReleasePredicate(state, duelReason.release | duelReason.summon), undefined, summonTypeCode);
}

export function tributeSetDuelCard(state: DuelState, player: PlayerId, uid: string, tributeUids: string[]): void {
  const card = findCard(state, uid);
  if (card && isMonsterSetPrevented(state, player, card, createContinuousEffectContext(state))) throw new Error(`${card.name} cannot be Set`);
  if (card) paySummonOrSetCosts(state, player, card, [94]);
  tributeSetDuelCardWithEvents(state, player, uid, tributeUids,
    createMaterialMover(state),
    createReleasePredicate(state, duelReason.release | duelReason.summon),
    (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard),
  );
}

export function flipSummonDuelCard(state: DuelState, player: PlayerId, uid: string): DuelCardInstance {
  const card = findCard(state, uid);
  if (card && isFlipSummonPrevented(state, card, createContinuousEffectContext(state))) throw new Error(`${card.name} cannot be Flip Summoned`);
  if (card) paySummonOrSetCosts(state, player, card, [93]);
  return flipSummonDuelCardWithEvents(state, player, uid, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard));
}

export function fusionSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  requireTypedSpecialSummonAllowed(state, player, uid, luaSummonTypeFusion, "Fusion Summoned");
  return fusionSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createMaterialMover(state), createMaterialUsePredicate(state, "fusion"));
}

export function synchroSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  requireTypedSpecialSummonAllowed(state, player, uid, luaSummonTypeSynchro, "Synchro Summoned");
  return synchroSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createMaterialMover(state), createMaterialUsePredicate(state, "synchro"));
}

export function xyzSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  requireTypedSpecialSummonAllowed(state, player, uid, luaSummonTypeXyz, "Xyz Summoned");
  return xyzSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createOverlayMaterialMover(state), createMaterialUsePredicate(state, "xyz"));
}

export function linkSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): DuelCardInstance {
  requireTypedSpecialSummonAllowed(state, player, uid, luaSummonTypeLink, "Link Summoned");
  return linkSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createMaterialMover(state), createMaterialUsePredicate(state, "link"));
}

export function ritualSummonDuelCard(state: DuelState, player: PlayerId, uid: string, materialUids: string[], position?: CardPosition): DuelCardInstance {
  requireTypedSpecialSummonAllowed(state, player, uid, luaSummonTypeRitual, "Ritual Summoned");
  return ritualSummonDuelCardWithEvents(state, player, uid, materialUids, (eventName, eventCard) => collectTriggerEffects(state, eventName, eventCard), createMaterialMover(state), createMaterialUsePredicate(state, "ritual"), position);
}

export function pendulumSummonDuelCards(state: DuelState, player: PlayerId, summonUids: string[]): DuelCardInstance[] {
  const summoned = pendulumSummonDuelCardsWithHooks(state, player, summonUids, (uid) => canSpecialSummonDuelCard(state, uid, player, luaSummonTypePendulum), (uid, controller) => specialSummonDuelCard(state, uid, controller, undefined, {}, luaSummonTypePendulum, false));
  collectDuelGroupedTriggerEffects(state, "specialSummoned", summoned);
  return summoned;
}

function canPerformTypedSpecialSummon(state: DuelState, player: PlayerId, uid: string, summonTypeCode: number): boolean {
  const card = findCard(state, uid);
  return Boolean(card && !isSpecialSummonPrevented(state, player, createContinuousEffectContext(state), card, summonTypeCode));
}

function canPerformTypedSpecialSummonAction(state: DuelState, player: PlayerId, action: DuelAction, summonTypeCode: number): boolean {
  return "uid" in action && canPerformTypedSpecialSummon(state, player, action.uid, summonTypeCode);
}

function requireTypedSpecialSummonAllowed(state: DuelState, player: PlayerId, uid: string, summonTypeCode: number, detail: string): void {
  if (canPerformTypedSpecialSummon(state, player, uid, summonTypeCode)) return;
  const card = findCard(state, uid);
  throw new Error(`${card?.name ?? uid} cannot be ${detail}`);
}

function createMaterialMover(state: DuelState): DuelMaterialMover {
  return (uid, controller, reason, targetUid) => {
    if ((reason & duelReason.release) !== 0 && isReleasePrevented(state, uid, reason, createContinuousEffectContext(state), targetUid)) throw new Error(`Card ${uid} cannot be released`);
    const card = sendDuelCardToGraveyard(state, uid, controller, reason);
    return { card, collectedSentToGraveyard: card.location === "graveyard" };
  };
}

function createOverlayMaterialMover(state: DuelState): DuelOverlayMaterialMover {
  return (uid, controller, reason, targetUid) => {
    if (isMaterialUsePrevented(state, uid, "xyz", createContinuousEffectContext(state), targetUid)) throw new Error(`Card ${uid} cannot be used as Xyz material`);
    requireDuelMoveAllowed(state, uid, "overlay", reason);
    return moveDuelCard(state, uid, "overlay", controller, reason);
  };
}

function createMaterialUsePredicate(state: DuelState, kind: "fusion" | "synchro" | "xyz" | "link" | "ritual"): DuelMaterialPredicate {
  return (uid, targetUid) => !isMaterialUsePrevented(state, uid, kind, createContinuousEffectContext(state), targetUid);
}

function createReleasePredicate(state: DuelState, reason: number): DuelMaterialPredicate {
  return (uid, targetUid) => !isReleasePrevented(state, uid, reason, createContinuousEffectContext(state), targetUid);
}

export function drawDuelCards(state: DuelState, player: PlayerId, count: number, detail = "Effect draw", payload: Pick<DuelEventPayload, "eventIsLast" | "eventReason" | "eventReasonPlayer" | "eventReasonCardUid" | "eventReasonEffectId"> = {}): number {
  if (!canDuelPlayerDraw(state, player, count)) return 0;
  const eventUids = getCards(state, player, "deck")
    .sort((a, b) => a.sequence - b.sequence)
    .slice(0, Math.max(0, count))
    .map((card) => card.uid);
  const drawn = drawDuelCardsFromDeck(state, player, Math.max(0, count), detail);
  if (drawn > 0) {
    const drawnUids = eventUids.slice(0, drawn);
    const drawnCards = drawnUids.map((uid) => findCard(state, uid)).filter((card): card is DuelCardInstance => Boolean(card));
    collectDuelGroupedTriggerEffects(state, "cardsDrawn", drawnCards, { eventPlayer: player, eventValue: drawn, eventUids: drawnUids, ...payload });
  }
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

export function getDuelAttackTargets(state: DuelState, attackerUid: string): DuelCardInstance[] { return getCoreDuelAttackTargets(state, attackerUid, coreBattleHandlers); }
export function getDuelAttackableTargets(state: DuelState, attackerUid: string): { targets: DuelCardInstance[]; directAttack: boolean } { return getCoreDuelAttackableTargets(state, attackerUid, coreBattleHandlers); }

export function calculateDuelBattle(state: DuelState, attackerUid: string, targetUid?: string): number {
  const attacker = findCard(state, attackerUid);
  if (!attacker || attacker.location !== "monsterZone") return 0;
  const target = targetUid === undefined ? undefined : findCard(state, targetUid);
  if (targetUid !== undefined && (!target || target.location !== "monsterZone")) return 0;
  const previousLifePoints = { 0: state.players[0].lifePoints, 1: state.players[1].lifePoints };
  state.currentAttack = { attackerUid, ...(targetUid === undefined ? {} : { targetUid }) };
  state.pendingBattle = { ...state.currentAttack };
  state.attackPasses = [];
  state.damagePasses = [];
  if (target) recordBattledPair(state, attacker.uid, target.uid);
  resolvePendingBattle(state, battleContinuationHandlers);
  return Math.max(0, previousLifePoints[0] - state.players[0].lifePoints) + Math.max(0, previousLifePoints[1] - state.players[1].lifePoints);
}

export function declareDuelAttack(state: DuelState, player: PlayerId, attackerUid: string, targetUid?: string): void {
  declareCoreDuelAttack(state, player, attackerUid, targetUid, coreBattleHandlers);
}

export function negateDuelAttack(state: DuelState, reasonPlayer: PlayerId = state.turnPlayer, payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): boolean {
  const attacker = state.currentAttack?.attackerUid === undefined ? undefined : findCard(state, state.currentAttack.attackerUid);
  const disabled = negateCoreDuelAttack(state);
  if (disabled) collectDuelTriggerEffects(state, "attackDisabled", attacker, attacker === undefined ? {} : { eventPlayer: attacker.controller, eventReason: duelReason.effect, eventReasonPlayer: reasonPlayer, ...payload });
  return disabled;
}

export function canChangeDuelCardPosition(state: DuelState, uid: string, position: CardPosition, source: "effect" | "manual" = "manual"): boolean {
  return canCoreChangeDuelCardPosition(state, uid, position, coreBattleHandlers, source);
}

export function changeDuelCardPosition(state: DuelState, player: PlayerId, uid: string, position: CardPosition, source: "effect" | "manual" = "effect", payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): DuelCardInstance {
  return changeCoreDuelCardPosition(state, player, uid, position, coreBattleHandlers, source, payload);
}

function createContinuousEffectContext(state: DuelState): ContinuousEffectContextFactory {
  return (effect, source, card, options) => Object.assign(createEffectContext(state, source, effect.controller, undefined, card, [], options?.checkOnly ?? true), options?.eventReason === undefined ? {} : { eventReason: options.eventReason }, options?.eventReasonPlayer === undefined ? {} : { eventReasonPlayer: options.eventReasonPlayer }, options?.eventDestination === undefined ? {} : { eventDestination: options.eventDestination }, options?.eventReasonCardUid === undefined ? {} : { eventReasonCardUid: options.eventReasonCardUid }, options?.eventReasonEffectId === undefined ? {} : { eventReasonEffectId: options.eventReasonEffectId }, options?.relatedEffectId === undefined ? {} : { relatedEffectId: options.relatedEffectId });
}

function paySummonOrSetCosts(state: DuelState, player: PlayerId, card: DuelCardInstance, codes: readonly number[]): void { applySummonOrSetCosts(state, player, createContinuousEffectContext(state), card, codes); }

function canEnterDuelPhase(state: DuelState, player: PlayerId, phase: DuelPhase): boolean {
  if (phase !== "main1" && phase !== "battle" && phase !== "main2" && phase !== "end") return true;
  return !isPhaseEntryPrevented(state, player, phase, createContinuousEffectContext(state));
}

function createReplacementEffectHandlers(state: DuelState): ReplacementEffectHandlers {
  return {
    createContinuousContext: createContinuousEffectContext(state),
    createReplacementContext(effect, source, card, checkOnly, reason, destination, reasonPlayer, payload = {}) {
      return Object.assign(createEffectContext(state, source, effect.controller, undefined, card, [], checkOnly), { eventReason: reason, eventReasonPlayer: reasonPlayer ?? card.controller, eventDestination: destination }, payload.eventReasonCardUid === undefined ? {} : { eventReasonCardUid: payload.eventReasonCardUid }, payload.eventReasonEffectId === undefined ? {} : { eventReasonEffectId: payload.eventReasonEffectId });
    },
    log(action, player, cardName, detail) {
      pushDuelLog(state, action, player, cardName, detail);
    },
  };
}

export function collectDuelTriggerEffects(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance, options: DuelEventPayload = {}, continuousChainLink?: ChainLink): void {
  collectDuelGroupedTriggerEffectsWithChooser(
    state,
    eventName,
    eventCard ? [eventCard] : [],
    options,
    (duel, effect, source, triggerEventName, triggerEventCard, payload) => canChooseEffect(duel, effect, source, effect.controller, triggerEventName, triggerEventCard, payload),
    executeNonChainSolvingContinuousEventEffects,
    continuousChainLink,
  );
}
export function collectDuelGroupedTriggerEffects(state: DuelState, eventName: DuelEventName, eventCards: DuelCardInstance[], options: DuelEventPayload = {}, continuousChainLink?: ChainLink): void {
  collectDuelGroupedTriggerEffectsWithChooser(
    state,
    eventName,
    eventCards,
    options,
    (duel, effect, source, triggerEventName, triggerEventCard, payload) => canChooseEffect(duel, effect, source, effect.controller, triggerEventName, triggerEventCard, payload),
    executeNonChainSolvingContinuousEventEffects,
    continuousChainLink,
  );
}
function collectBattleEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance | DuelCardInstance[], payload: DuelEventPayload = {}): void {
  Array.isArray(eventCard) ? collectDuelGroupedTriggerEffects(state, eventName, eventCard, payload) : collectDuelTriggerEffects(state, eventName, eventCard, payload);
}
function collectTriggerEffects(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance, options?: DuelEventPayload): void {
  collectDuelTriggerEffects(state, eventName, eventCard, options);
}
function executeContinuousPhaseEffects(state: DuelState, phase: DuelPhase): void {
  const code = 0x1000 | phaseMask(phase);
  for (const effect of [...state.effects]) {
    if (effect.event !== "continuous" || effect.code !== code || !canUseEffectCount(state, effect)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location) || !continuousEffectSourceIsActive(effect, source)) continue;
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

function quickEffectActions(state: DuelState, player: PlayerId): DuelAction[] {
  return getQuickEffectActions(state, player, canChooseEffect);
}

function canChooseEffect(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId, eventName?: DuelEventName, eventCard?: DuelCardInstance, payload: DuelEventPayload = {}): boolean {
  if (source.location === "monsterZone" && !source.faceUp && ((effect.property ?? 0) & 0x100) === 0 && !(effect.event === "trigger" && effect.triggerSourceOnly === true && eventCard?.uid === source.uid && (eventName === "flipSummoning" || eventName === "monsterSet"))) return false;
  if (isEffectActivationPrevented(state, player, source, createContinuousEffectContext(state), effect)) return false;
  if (!canActivateSpellTrapCardEffect(state, player, source, effect)) return false;
  const quickEvent = eventName === undefined ? quickEffectEventContext(state, effect) : undefined;
  const ctx = createEffectContext(
    state,
    source,
    player,
    eventName ?? quickEvent?.eventName,
    eventCard ?? quickEvent?.eventCard,
    [],
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    quickEvent?.eventCode ?? payload.eventCode,
    quickEvent?.eventPlayer ?? payload.eventPlayer,
    quickEvent?.eventValue ?? payload.eventValue,
    quickEvent?.eventReason ?? payload.eventReason,
    quickEvent?.eventReasonPlayer ?? payload.eventReasonPlayer,
    quickEvent?.eventReasonCardUid ?? payload.eventReasonCardUid,
    quickEvent?.eventReasonEffectId ?? payload.eventReasonEffectId,
    quickEvent?.relatedEffectId ?? payload.relatedEffectId,
    quickEvent?.eventChainDepth ?? payload.eventChainDepth,
    quickEvent?.eventChainLinkId ?? payload.eventChainLinkId,
    quickEvent?.eventUids ?? payload.eventUids,
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
  eventReasonCardUid?: string,
  eventReasonEffectId?: number,
  relatedEffectId?: number,
  eventChainDepth?: number,
  eventChainLinkId?: string,
  eventUids?: string[],
  eventPreviousState?: DuelEventCardState,
  eventCurrentState?: DuelEventCardState,
  eventTriggerTiming?: ChainLink["eventTriggerTiming"],
  operationInfos: ChainLink["operationInfos"] = [],
  possibleOperationInfos: ChainLink["possibleOperationInfos"] = [],
  effectLabel?: number,
  effectLabels?: number[],
  effectLabelObjectUid?: string,
  effectLabelObjectUids?: string[],
): void {
  const source = findCard(state, sourceUid);
  const chainLinkId = `chain-${state.log.length + 1}`;
  state.chain.push({
    id: chainLinkId,
    chainIndex: state.chain.length + 1,
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
    ...(eventReasonCardUid === undefined ? {} : { eventReasonCardUid }),
    ...(eventReasonEffectId === undefined ? {} : { eventReasonEffectId }),
    ...(relatedEffectId === undefined ? {} : { relatedEffectId }),
    ...(eventChainDepth === undefined ? {} : { eventChainDepth }),
    ...(eventChainLinkId === undefined ? {} : { eventChainLinkId }),
    ...(eventUids === undefined || eventUids.length === 0 ? {} : { eventUids: [...eventUids] }),
    ...eventCardStatePayload(eventCard),
    ...(eventPreviousState === undefined ? {} : { eventPreviousState: { ...eventPreviousState } }),
    ...(eventCurrentState === undefined ? {} : { eventCurrentState: { ...eventCurrentState } }),
    ...(eventTriggerTiming === undefined ? {} : { eventTriggerTiming }),
    ...(eventCard === undefined ? {} : { eventCardUid: eventCard.uid }),
    ...(targetUids.length === 0 ? {} : { targetUids: [...targetUids] }),
    ...(operationInfos.length === 0 ? {} : { operationInfos: copyDuelOperationInfos(operationInfos) }),
    ...(possibleOperationInfos.length === 0 ? {} : { possibleOperationInfos: copyDuelOperationInfos(possibleOperationInfos) }),
    ...(targetPlayer === undefined ? {} : { targetPlayer }),
    ...(targetParam === undefined ? {} : { targetParam }),
    ...(effectLabel === undefined ? {} : { effectLabel }),
    ...(effectLabels === undefined || effectLabels.length === 0 ? {} : { effectLabels: [...effectLabels] }),
    ...(effectLabelObjectUid === undefined ? {} : { effectLabelObjectUid }),
    ...(effectLabelObjectUids === undefined ? {} : { effectLabelObjectUids: [...effectLabelObjectUids] }),
  });
  if (source) {
    recordChainActivity(state, player, source, effectId);
    collectTriggerEffects(state, "chainActivating", source);
    collectDuelTriggerEffects(state, "chaining", source, {
      eventPlayer: player,
      eventValue: state.chain.length,
      eventChainDepth: state.chain.length,
      eventChainLinkId: chainLinkId,
      eventReasonPlayer: player,
      ...relatedEffectPayload(effectId),
    });
  }
  for (const targetUid of targetUids) {
    const target = findCard(state, targetUid);
    if (target) {
      const payload = { eventChainDepth: state.chain.length, eventChainLinkId: chainLinkId, eventReasonPlayer: player, ...relatedEffectPayload(effectId) };
      collectDuelTriggerEffects(state, "becameTarget", target, payload);
    }
  }
  markDuelPhaseActivity(state);
  state.chainPasses = [];
  markBattleWindowChainStarted(state);
  clearStaleChainLimits(state);
}

function copyDuelOperationInfos(infos: NonNullable<ChainLink["operationInfos"]>): NonNullable<ChainLink["operationInfos"]> { return infos.map((info) => ({ category: typeof info.category === "number" && Number.isFinite(info.category) ? info.category : 0, targetUids: Array.isArray(info.targetUids) ? [...info.targetUids] : [], count: typeof info.count === "number" && Number.isFinite(info.count) ? info.count : 0, player: info.player === 1 ? 1 : 0, parameter: typeof info.parameter === "number" && Number.isFinite(info.parameter) ? info.parameter : 0 })); }

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
  let suspended = false;
  state.status = "resolving";
  try {
    while (state.chain.length) {
      const link = state.chain.pop();
      if (!link) continue;
      const effect = state.effects.find((candidate) => candidate.id === link.effectId && candidate.sourceUid === link.sourceUid);
      const source = findCard(state, link.sourceUid);
      if (link.negated) {
        sendResolvedActivatedSpellTrapToGraveyard(state, link, source, effect);
        collectNegatedChainLinkEvents(state, link);
        continue;
      }
      if (!effect || !source) continue;
      const eventCard = link.eventCardUid === undefined ? undefined : findCard(state, link.eventCardUid);
      const chainPayload = { eventPlayer: link.player, eventValue: state.chain.length + 1, eventChainDepth: state.chain.length + 1, eventChainLinkId: link.id, eventReasonPlayer: link.player, ...relatedEffectPayload(link.effectId) };
      collectDuelTriggerEffects(state, "chainSolving", source, chainPayload);
      executeContinuousEventEffects(state, "chainSolving", 1020, [source], chainPayload, link);
      if (link.negated) {
        sendResolvedActivatedSpellTrapToGraveyard(state, link, source, effect);
        collectNegatedChainLinkEvents(state, link);
        continue;
      }
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
        link.eventReasonCardUid,
        link.eventReasonEffectId,
        link.relatedEffectId,
        link.eventChainDepth,
        link.eventChainLinkId,
        link.eventUids,
        link.operationInfos ? copyDuelOperationInfos(link.operationInfos) : [],
        link.possibleOperationInfos ? copyDuelOperationInfos(link.possibleOperationInfos) : [],
      );
      if (link.effectLabels !== undefined) ctx.effectLabels = [...link.effectLabels];
      if (link.effectLabelObjectUid !== undefined) ctx.effectLabelObjectUid = link.effectLabelObjectUid;
      if (link.effectLabelObjectUids !== undefined) ctx.effectLabelObjectUids = [...link.effectLabelObjectUids];
      const finishLink = () => {
        sendResolvedActivatedSpellTrapToGraveyard(state, link, source, effect);
        collectDuelTriggerEffects(state, "chainSolved", undefined, chainPayload, link);
      };
      const result = link.operationOverride ? undefined : runPromptOperation(effect, ctx);
      if (result !== undefined && isYieldedLuaPromptCoroutineResult(result)) {
        applyYieldedLuaPromptToDuelState(state, result, link.player);
        state.luaOperationPrompt = { chainLink: copyLuaOperationPromptChainLink(link), prompt: copyLuaOperationPromptDecision(result.prompt) };
        setPendingLuaOperationPrompt(state, result, () => {
          state.status = "resolving";
          delete state.luaOperationPrompt;
          finishLink();
          resolveChain(state);
        });
        suspended = true;
        return;
      }
      if (result?.status === "error") throw new Error(result.error);
      if (result === undefined) (link.operationOverride ?? effect.operation)(ctx);
      finishLink();
    }
  } catch (error) {
    restoreDuelState(state, rollback);
    throw error;
  } finally {
    if (!suspended) clearChainLimits(state);
  }
  if (suspended) return;
  pruneResetEffectsAfterChain(state);
  pruneDuelFlagEffectsAfterChain(state);
  applyContinuousSelfDestroyEffects(state, destroyDuelCard);
  const resolvedStatus = (state as { status: DuelStatus }).status;
  if (resolvedStatus === "ended") return;
  state.chainPasses = [];
  state.status = "awaiting";
  if (state.pendingTriggers.length === 0) collectTriggerEffects(state, "chainEnded");
  setWaitingForPendingTriggerBucket(state);
  continueAttackResponseWindow(state, battleContinuationHandlers);
}

function runPromptOperation(effect: DuelEffectDefinition, ctx: Parameters<DuelEffectDefinition["operation"]>[0]): LuaPromptCoroutineResult | undefined {
  if (effect.event !== "ignition") return undefined;
  if (ctx.source.code !== "729" && ctx.source.code !== "730") return undefined;
  return effect.promptOperation?.(ctx) as LuaPromptCoroutineResult | undefined;
}

function copyLuaOperationPromptChainLink(link: ChainLink): ChainLink {
  const { operationOverride: _operationOverride, ...publicLink } = link;
  return {
    ...publicLink,
    ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }),
    ...(link.operationInfos === undefined ? {} : { operationInfos: copyDuelOperationInfos(link.operationInfos) }),
    ...(link.possibleOperationInfos === undefined ? {} : { possibleOperationInfos: copyDuelOperationInfos(link.possibleOperationInfos) }),
    ...(link.effectLabels === undefined ? {} : { effectLabels: [...link.effectLabels] }),
    ...(link.effectLabelObjectUids === undefined ? {} : { effectLabelObjectUids: [...link.effectLabelObjectUids] }),
    ...(link.eventUids === undefined ? {} : { eventUids: [...link.eventUids] }),
    ...(link.eventPreviousState === undefined ? {} : { eventPreviousState: { ...link.eventPreviousState } }),
    ...(link.eventCurrentState === undefined ? {} : { eventCurrentState: { ...link.eventCurrentState } }),
  };
}

function copyLuaOperationPromptDecision(prompt: Extract<LuaPromptCoroutineResult, { status: "yielded" }>["prompt"]): Extract<LuaPromptCoroutineResult, { status: "yielded" }>["prompt"] {
  if (isLuaOptionPromptDecision(prompt)) return { ...prompt, options: [...prompt.options], descriptions: [...prompt.descriptions] };
  return { ...prompt };
}

function sendResolvedActivatedSpellTrapToGraveyard(state: DuelState, link: ChainLink, source: DuelCardInstance | undefined, effect: DuelEffectDefinition | undefined): void {
  if (!source || !effect || !shouldSendActivatedSpellTrapToGraveyard(state, source, effect, link.negated)) return;
  sendDuelCardToGraveyard(state, source.uid, source.controller, duelReason.rule, link.player);
}

function collectNegatedChainLinkEvents(state: DuelState, link: ChainLink): void {
  pushDuelLog(state, "chainNegated", link.player, undefined, link.effectId);
  const payload = { eventPlayer: link.player, eventValue: state.chain.length + 1, eventChainDepth: state.chain.length + 1, eventChainLinkId: link.id, eventReasonPlayer: link.player, ...relatedEffectPayload(link.effectId) };
  collectDuelTriggerEffects(state, "chainNegated", undefined, payload);
  collectDuelTriggerEffects(state, "chainDisabled", undefined, payload);
}
