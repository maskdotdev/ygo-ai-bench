import { markDuelPhaseActivity, recordSpecialSummonActivity } from "#duel/activity.js";
import {
  findCard,
  canMoveDuelCardToLocation as canMoveDuelCardToLocationRule,
  getCards,
  hasZoneSpace,
  moveDuelCard,
  pushDuelLog,
  requireControlledCard,
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
import { getDuelAttackCostPaid as getDuelAttackCostPaidRule, positionChangeActions, setDuelAttackCostPaid as setDuelAttackCostPaidRule } from "#duel/battle.js";
import {
  appendBattleActions,
  canCoreChangeDuelCardPosition,
  canCoreDuelCardAttack,
  changeCoreDuelCardPosition,
  declareCoreDuelAttack,
  getCoreDuelAttackTargets,
  getCoreAdditionalBattleDamagePlayers,
  getCoreBattleAttackValue,
  getCoreBattleDamageReason,
  getCoreBattleDefenseValue,
  hasCoreMustAttackAction,
  hasCorePiercingBattleDamage,
  negateCoreDuelAttack,
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
  isMaterialUsePrevented,
  isMoveToLocationPrevented,
  isReleasePrevented,
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
import { pruneResetEffectsAfterChain } from "#duel/effect-reset.js";
import { pruneDuelFlagEffectsAfterChain } from "#duel/flags.js";
import type { ReplacementEffectHandlers } from "#duel/replacement-effects.js";
import { getPendingTriggerActions } from "#duel/pending-trigger-actions.js";
import { hasQuickEffectResponses, quickEffectActions as getQuickEffectActions } from "#duel/quick-effect-actions.js";
import { applyDuelResponse, type DuelResponseHandlers } from "#duel/response-dispatch.js";
import { collectTriggerEffects as collectTriggerEffectsRule } from "#duel/triggers.js";
import { changeDuelPhase, drawDuelCardsFromDeck, endDuelTurn, nextAvailableDuelPhase } from "#duel/turn-flow.js";
export { createDuel, loadDecks, startDuel, type CreateDuelOptions } from "#duel/setup.js";
import type {
  ApplyDuelResponseResult,
  CardPosition,
  ChainLimit,
  ChainLink,
  DuelAction,
  DuelCardInstance,
  DuelEffectContext,
  DuelEffectDefinition,
  DuelEventName,
  DuelLocation,
  DuelPhase,
  DuelPromptState,
  DuelResponse,
  DuelSession,
  DuelState,
  DuelStatus,
  PlayerId,
} from "#duel/types.js";

export { moveDuelCard } from "#duel/card-state.js";
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
  setMonster,
  setSpellTrap,
  activateEffect(session, player, uid, effectId) {
    activateDuelEffect(session, player, uid, effectId, activationHandlers);
  },
  passChain,
  passAttack: (state, player) => passAttackResponseWindow(state, player, battleContinuationHandlers),
  passDamage: (state, player) => passDamageResponseWindow(state, player, battleContinuationHandlers),
  resolvePrompt,
  activateTrigger(session, player, triggerId) {
    activateDuelPendingTrigger(session, player, triggerId, activationHandlers);
  },
  declineTrigger(session, player, triggerId) {
    declineDuelPendingTrigger(session, player, triggerId);
    continueAttackResponseWindow(session.state, battleContinuationHandlers);
  },
  flipSummon: flipSummonDuelCard,
  changePosition: changeDuelCardPosition,
  declareAttack: declareDuelAttack,
  changePhase(state, player, phase) {
    changeDuelPhase(state, player, phase, {
      collectEvent: (eventName) => collectTriggerEffects(state, eventName),
      executePhaseEffects: (reachedPhase) => executeContinuousPhaseEffects(state, reachedPhase),
    });
  },
  endTurn(state, player) {
    endDuelTurn(state, player, {
      collectEvent: (eventName) => collectTriggerEffects(state, eventName),
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
    return stampActions(actions, state.actionWindowId);
  }
  if (state.chain.length) {
    actions.push(...getChainResponseActions(state, player));
    return stampActions(actions, state.actionWindowId);
  }
  if (state.pendingTriggers.length) {
    actions.push(...getPendingTriggerActions(state, player));
    return stampActions(actions, state.actionWindowId);
  }
  if (state.pendingBattle) {
    actions.push(...battleWindowActions(state, player, quickEffectActions));
    return stampActions(actions, state.actionWindowId);
  }
  const hand = getCards(state, player, "hand");
  if (state.phase === "main1" || state.phase === "main2") {
    actions.push(...normalSummonActions(state, player, hand, () => isNoTributeSummonAllowed(state, player)));
    actions.push(...tributeSummonActions(state, player, hand, createReleasePredicate(state, duelReason.release | duelReason.summon)));
    actions.push(...fusionSummonActions(state, player, createMaterialUsePredicate(state, "fusion")));
    actions.push(...synchroSummonActions(state, player, createMaterialUsePredicate(state, "synchro")));
    actions.push(...xyzSummonActions(state, player, (uid) => !isMaterialUsePrevented(state, uid, "xyz", createContinuousEffectContext(state))));
    actions.push(...linkSummonActions(state, player, createMaterialUsePredicate(state, "link")));
    actions.push(...ritualSummonActions(state, player, hand, createMaterialUsePredicate(state, "ritual")));
    actions.push(...specialSummonProcedureActions(state, player));
    if (hasZoneSpace(state, player, "spellTrapZone")) {
      for (const card of hand.filter((candidate) => candidate.kind === "spell" || candidate.kind === "trap")) {
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
    actions.push(...positionChangeActions(state, player));
    actions.push(...flipSummonActions(state, player));
  }
  appendBattleActions(actions, state, player, coreBattleHandlers);
  const mustAttack = hasCoreMustAttackAction(state, player, actions, coreBattleHandlers);
  const nextPhase = nextAvailableDuelPhase(state, player);
  if (!mustAttack && nextPhase) actions.push({ type: "changePhase", player, phase: nextPhase, label: `Go to ${nextPhase}` });
  if (!mustAttack) actions.push({ type: "endTurn", player, label: "End turn" });
  return stampActions(actions, state.actionWindowId);
}

export function applyResponse(session: DuelSession, response: DuelResponse): ApplyDuelResponseResult {
  return applyDuelResponse(session, response, responseHandlers);
}

export function specialSummonDuelCard(state: DuelState, uid: string, controller?: PlayerId): DuelCardInstance {
  const card = findCard(state, uid);
  if (!card) throw new Error(`Card ${uid} is not in the duel`);
  const summonController = controller ?? card.controller;
  requireZoneSpace(state, summonController, "monsterZone");
  if (!canSpecialSummonDuelCard(state, uid, summonController)) throw new Error(`${card.name} cannot be Special Summoned`);
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
  if (!card || !isMonsterLike(card)) return false;
  const summonController = controller ?? card.controller;
  if (isSpecialSummonPrevented(state, summonController, createContinuousEffectContext(state), card)) return false;
  if (!hasZoneSpace(state, summonController, "monsterZone")) return false;
  if (card.location === "extraDeck" && !isFaceUpPendulumExtraDeckCard(card)) return false;
  return canMoveDuelCardToLocation(state, uid, "monsterZone");
}

function canAttemptSpecialSummonProcedure(state: DuelState, uid: string): boolean {
  const card = findCard(state, uid);
  if (!card || !isMonsterLike(card)) return false;
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

export function damageDuelPlayer(state: DuelState, player: PlayerId, amount: number, reason = 0): number {
  const value = Math.max(0, Math.floor(amount));
  state.players[player].lifePoints = Math.max(0, state.players[player].lifePoints - value);
  pushDuelLog(state, (reason & duelReason.effect) !== 0 && (reason & duelReason.battle) === 0 ? "effectDamage" : "damage", player, undefined, String(value));
  if (state.players[player].lifePoints <= 0) state.status = "ended";
  return value;
}

export function recoverDuelPlayer(state: DuelState, player: PlayerId, amount: number): number {
  const value = Math.max(0, Math.floor(amount));
  state.players[player].lifePoints += value;
  pushDuelLog(state, "recover", player, undefined, String(value));
  return value;
}

export function raiseDuelEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void {
  collectTriggerEffects(state, eventName, eventCard);
}

export function setDuelAttackCostPaid(state: DuelState, status: number): number {
  return setDuelAttackCostPaidRule(state, status);
}

export function getDuelAttackCostPaid(state: DuelState): number {
  return getDuelAttackCostPaidRule(state);
}

export function setDuelPlayerLifePoints(state: DuelState, player: PlayerId, lifePoints: number): void {
  state.players[player].lifePoints = Math.max(0, Math.floor(lifePoints));
  pushDuelLog(state, "setLifePoints", player, undefined, String(state.players[player].lifePoints));
  if (state.players[player].lifePoints <= 0) state.status = "ended";
}

export function tributeSummonDuelCard(state: DuelState, player: PlayerId, uid: string, tributeUids: string[]): void {
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
  return drawDuelCardsFromDeck(state, player, Math.max(0, count), detail);
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

export function canChangeDuelCardPosition(state: DuelState, uid: string, position: CardPosition): boolean {
  return canCoreChangeDuelCardPosition(state, uid, position);
}

export function changeDuelCardPosition(state: DuelState, player: PlayerId, uid: string, position: CardPosition): DuelCardInstance {
  return changeCoreDuelCardPosition(state, player, uid, position, coreBattleHandlers);
}

function setSpellTrap(state: DuelState, player: PlayerId, uid: string): void {
  const card = requireControlledCard(state, player, uid, "hand");
  if (card.kind !== "spell" && card.kind !== "trap") throw new Error(`${card.name} is not a spell/trap`);
  requireZoneSpace(state, player, "spellTrapZone");
  moveDuelCard(state, uid, "spellTrapZone", player, duelReason.rule);
  card.position = "faceDown";
  card.faceUp = false;
  pushDuelLog(state, "set", player, card.name, "Set from hand");
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
): DuelEffectContext {
  const ctx: DuelEffectContext = {
    duel: state,
    source,
    player,
    activationLocation,
    activationSequence,
    ...(eventName === undefined ? {} : { eventName }),
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

function collectTriggerEffects(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void {
  recordDuelEvent(state, eventName, eventCard);
  collectTriggerEffectsRule(state, eventName, (duel, effect, source, triggerEventName, triggerEventCard) => canChooseEffect(duel, effect, source, effect.controller, triggerEventName, triggerEventCard), eventCard);
}

function recordDuelEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void {
  state.eventHistory.push({ eventName, ...(eventCard ? { eventCardUid: eventCard.uid } : {}) });
  state.eventHistory = state.eventHistory.slice(-32);
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

function phaseMask(phase: DuelPhase): number {
  if (phase === "draw") return 0x1;
  if (phase === "standby") return 0x2;
  if (phase === "main1") return 0x4;
  if (phase === "battle") return 0x80;
  if (phase === "main2") return 0x100;
  return 0x200;
}

function getChainResponseActions(state: DuelState, player: PlayerId): DuelAction[] {
  const actions = quickEffectActions(state, player);
  actions.push({ type: "passChain", player, label: "Pass" });
  return actions;
}

function getPromptResponseActions(prompt: DuelPromptState, player: PlayerId): DuelAction[] {
  if (prompt.player !== player) return [];
  if (prompt.type === "selectOption") {
    return prompt.options.map((option) => ({ type: "selectOption", player, promptId: prompt.id, option, label: `Select option ${option}` }));
  }
  return [
    { type: "selectYesNo", player, promptId: prompt.id, yes: true, label: "Yes" },
    { type: "selectYesNo", player, promptId: prompt.id, yes: false, label: "No" },
  ];
}

function resolvePrompt(state: DuelState, response: Extract<DuelResponse, { type: "selectOption" | "selectYesNo" }>): void {
  const prompt = state.prompt;
  if (!prompt || prompt.id !== response.promptId || prompt.player !== response.player || prompt.type !== response.type) throw new Error("Prompt response does not match the pending prompt");
  if (prompt.type === "selectOption") {
    if (response.type !== "selectOption" || !prompt.options.includes(response.option)) throw new Error(`Option ${response.type === "selectOption" ? response.option : ""} is not legal`);
    pushDuelLog(state, "selectOption", response.player, undefined, `Selected option ${response.option}`);
  } else {
    if (response.type !== "selectYesNo") throw new Error("Prompt response does not match the pending prompt");
    pushDuelLog(state, "selectYesNo", response.player, undefined, response.yes ? "Selected yes" : "Selected no");
  }
  state.waitingFor = prompt.returnTo ?? state.turnPlayer;
  delete state.prompt;
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

function canChooseEffect(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId, eventName?: DuelEventName, eventCard?: DuelCardInstance): boolean {
  const ctx = createEffectContext(state, source, player, eventName, eventCard, [], true);
  if (effect.canActivate && !effect.canActivate(ctx)) return false;
  if (effect.cost && !effect.cost(ctx)) return false;
  if (effect.target && !effect.target(ctx)) return false;
  return true;
}

function hasChainResponses(state: DuelState, player: PlayerId): boolean {
  return hasQuickEffectResponses(state, player, canChooseEffect);
}

function stampActions(actions: DuelAction[], windowId: number): DuelAction[] {
  return actions.map((action) => ({ ...action, windowId }));
}

export function addDuelChainLimit(state: DuelState, limit: Omit<ChainLimit, "expiresAtChainLength">): void {
  state.chainLimits.push({
    ...limit,
    ...(limit.untilChainEnd ? {} : { expiresAtChainLength: state.chain.length + 1 }),
  });
}

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
): void {
  const source = findCard(state, sourceUid);
  state.chain.push({
    id: `chain-${state.log.length + 1}`,
    player,
    sourceUid,
    effectId,
    ...(source === undefined ? {} : { activationLocation: source.location, activationSequence: source.sequence }),
    ...(eventName === undefined ? {} : { eventName }),
    ...(eventCard === undefined ? {} : { eventCardUid: eventCard.uid }),
    ...(targetUids.length === 0 ? {} : { targetUids: [...targetUids] }),
    ...(targetPlayer === undefined ? {} : { targetPlayer }),
    ...(targetParam === undefined ? {} : { targetParam }),
  });
  markDuelPhaseActivity(state);
  state.chainPasses = [];
  markBattleWindowChainStarted(state);
  clearStaleChainLimits(state);
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
        continue;
      }
      const effect = state.effects.find((candidate) => candidate.id === link.effectId && candidate.sourceUid === link.sourceUid);
      const source = findCard(state, link.sourceUid);
      if (!effect || !source) continue;
      const eventCard = link.eventCardUid === undefined ? undefined : findCard(state, link.eventCardUid);
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
      );
      (link.operationOverride ?? effect.operation)(ctx);
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
  state.waitingFor = state.pendingTriggers[0]?.player ?? state.turnPlayer;
  continueAttackResponseWindow(state, battleContinuationHandlers);
}

function clearStaleChainLimits(state: DuelState): void {
  clearChainLimits(state, (limit) => !limit.untilChainEnd && (limit.expiresAtChainLength ?? 0) < state.chain.length);
}

function clearChainLimits(state: DuelState, shouldClear: (limit: ChainLimit) => boolean = () => true): void {
  const remaining: ChainLimit[] = [];
  for (const limit of state.chainLimits) {
    if (shouldClear(limit)) limit.release?.();
    else remaining.push(limit);
  }
  state.chainLimits = remaining;
}

export function negateDuelChainLink(state: DuelState, chainLinkId: string, player: PlayerId, cardName: string): boolean {
  const link = state.chain.find((candidate) => candidate.id === chainLinkId);
  if (!link || link.negated) return false;
  link.negated = true;
  link.disableReason = duelReason.effect;
  link.disablePlayer = player;
  pushDuelLog(state, "negate", player, cardName, link.effectId);
  return true;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function isMonsterLike(card: DuelCardInstance): boolean {
  return card.kind === "monster" || (card.data.typeFlags !== undefined && (card.data.typeFlags & 0x1) !== 0) || (card.kind === "extra" && card.data.kind !== "spell" && card.data.kind !== "trap");
}

function isFaceUpPendulumExtraDeckCard(card: DuelCardInstance): boolean {
  return card.faceUp && ((card.data.typeFlags ?? 0) & 0x1000000) !== 0;
}
