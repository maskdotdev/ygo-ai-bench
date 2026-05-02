import { findCard } from "#duel/card-state.js";
import {
  attackActions,
  canChangeDuelCardPosition as canChangeDuelCardPositionRule,
  canDuelCardAttack as canDuelCardAttackRule,
  changeDuelCardPosition as changeDuelCardPositionRule,
  declareDuelAttack as declareDuelAttackRule,
  getDuelAttackTargets as getDuelAttackTargetsRule,
  negateDuelAttack as negateDuelAttackRule,
} from "#duel/battle.js";
import { openAttackResponseWindow } from "#duel/attack-response-window.js";
import {
  additionalBattleDamagePlayers,
  battleDamageReason,
  extraAttackCount,
  hasMustAttackMonsterRestriction,
  hasPiercingBattleDamage,
  isAttackPrevented,
  isBattleTargetSelectionPrevented,
  isBattleTargetPrevented,
  isDirectAttackPrevented,
  mustAttackMonsterTargetAllowed,
  type ContinuousEffectContextFactory,
} from "#duel/continuous-effects.js";
import type { CardPosition, DuelAction, DuelCardInstance, DuelEventName, DuelState, PlayerId } from "#duel/types.js";

export interface CoreBattleHandlers {
  additionalBattleDamagePlayers(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): PlayerId[];
  battleDamagePlayer(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): PlayerId;
  battleDamageReason(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): number;
  changeBattleDamage(state: DuelState, player: PlayerId, amount: number, battleCards?: DuelCardInstance[]): number;
  collectEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void;
  createContinuousContext(state: DuelState): ContinuousEffectContextFactory;
  damagePlayer(state: DuelState, player: PlayerId, amount: number, reason?: number): number;
  destroyCard(state: DuelState, uid: string, controller?: PlayerId, reason?: number, reasonPlayer?: PlayerId): DuelCardInstance;
  hasPiercingDamage(state: DuelState, card: DuelCardInstance): boolean;
}

export function appendBattleActions(actions: DuelAction[], state: DuelState, player: PlayerId, handlers: CoreBattleHandlers): void {
  if (state.phase !== "battle") return;
  const createContext = handlers.createContinuousContext(state);
  for (const action of attackActions(
    state,
    player,
    (card) => extraAttackCount(state, card, createContext),
    (card) => canSelectBattleTarget(state, player, card, createContext),
  )) {
    if (action.type !== "declareAttack") continue;
    const attacker = findCard(state, action.attackerUid);
    if (!attacker || isAttackPrevented(state, attacker, createContext)) continue;
    if (action.targetUid === undefined && (isDirectAttackPrevented(state, attacker, createContext) || hasMustAttackMonsterRestriction(state, attacker, createContext))) continue;
    const target = action.targetUid === undefined ? undefined : findCard(state, action.targetUid);
    if (target && !canAttackMonsterTarget(state, attacker, target, createContext)) continue;
    actions.push(action);
  }
}

export function canCoreDuelCardAttack(state: DuelState, uid: string, handlers: CoreBattleHandlers): boolean {
  const card = findCard(state, uid);
  const createContext = handlers.createContinuousContext(state);
  return Boolean(card && !isAttackPrevented(state, card, createContext) && canDuelCardAttackRule(state, uid, extraAttackCount(state, card, createContext)));
}

export function getCoreDuelAttackTargets(state: DuelState, attackerUid: string, handlers: CoreBattleHandlers): DuelCardInstance[] {
  const card = findCard(state, attackerUid);
  const createContext = handlers.createContinuousContext(state);
  if (!card || isAttackPrevented(state, card, createContext)) return [];
  return getDuelAttackTargetsRule(
    state,
    attackerUid,
    extraAttackCount(state, card, createContext),
    (target) => canSelectBattleTarget(state, card.controller, target, createContext) && canAttackMonsterTarget(state, card, target, createContext),
  );
}

export function declareCoreDuelAttack(state: DuelState, player: PlayerId, attackerUid: string, targetUid: string | undefined, handlers: CoreBattleHandlers): void {
  const attacker = findCard(state, attackerUid);
  const createContext = handlers.createContinuousContext(state);
  if (attacker && isAttackPrevented(state, attacker, createContext)) throw new Error(`${attacker.name} cannot attack`);
  if (attacker && targetUid === undefined && isDirectAttackPrevented(state, attacker, createContext)) throw new Error(`${attacker.name} cannot attack directly`);
  if (attacker && targetUid === undefined && hasMustAttackMonsterRestriction(state, attacker, createContext)) throw new Error(`${attacker.name} must attack a monster`);
  state.battleDamage = { 0: 0, 1: 0 };
  const pendingTriggerCount = state.pendingTriggers.length;
  declareDuelAttackRule(state, player, attackerUid, targetUid, {
    collectEvent: (eventName, eventCard) => handlers.collectEvent(state, eventName, eventCard),
    damagePlayer: (damagedPlayer, amount, battleCards) => {
      const damagePlayer = handlers.battleDamagePlayer(state, damagedPlayer, battleCards);
      if (damagePlayer !== damagedPlayer) handlers.changeBattleDamage(state, damagedPlayer, 0, battleCards);
      handlers.changeBattleDamage(state, damagePlayer, amount, battleCards);
      const applied = handlers.damagePlayer(state, damagePlayer, state.battleDamage[damagePlayer], handlers.battleDamageReason(state, damagePlayer, battleCards));
      for (const additionalPlayer of handlers.additionalBattleDamagePlayers(state, damagePlayer, battleCards)) {
        if (additionalPlayer === damagePlayer) continue;
        handlers.changeBattleDamage(state, additionalPlayer, applied, battleCards);
        handlers.damagePlayer(state, additionalPlayer, state.battleDamage[additionalPlayer], handlers.battleDamageReason(state, additionalPlayer, battleCards));
      }
      return applied;
    },
    destroyCard: (uid, controller, reason, reasonPlayer) => handlers.destroyCard(state, uid, controller, reason, reasonPlayer),
    hasPiercingDamage: (card) => handlers.hasPiercingDamage(state, card),
  }, attacker ? extraAttackCount(state, attacker, createContext) : 0, (target) => !attacker || (canSelectBattleTarget(state, attacker.controller, target, createContext) && canAttackMonsterTarget(state, attacker, target, createContext)));
  if (state.pendingTriggers.length === pendingTriggerCount) openAttackResponseWindow(state, player);
}

export function negateCoreDuelAttack(state: DuelState): boolean {
  return negateDuelAttackRule(state);
}

export function canCoreChangeDuelCardPosition(state: DuelState, uid: string, position: CardPosition): boolean {
  return canChangeDuelCardPositionRule(state, uid, position);
}

export function changeCoreDuelCardPosition(state: DuelState, player: PlayerId, uid: string, position: CardPosition, handlers: CoreBattleHandlers): DuelCardInstance {
  return changeDuelCardPositionRule(state, player, uid, position, (eventName, eventCard) => handlers.collectEvent(state, eventName, eventCard));
}

function canSelectBattleTarget(state: DuelState, player: PlayerId, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  return !isBattleTargetPrevented(state, card, createContext) && !isBattleTargetSelectionPrevented(state, player, card, createContext);
}

function canAttackMonsterTarget(state: DuelState, attacker: DuelCardInstance, target: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  return mustAttackMonsterTargetAllowed(state, attacker, target, createContext);
}

export function hasCorePiercingBattleDamage(state: DuelState, card: DuelCardInstance, handlers: CoreBattleHandlers): boolean {
  return hasPiercingBattleDamage(state, card, handlers.createContinuousContext(state));
}

export function getCoreAdditionalBattleDamagePlayers(state: DuelState, player: PlayerId, battleCards: DuelCardInstance[] | undefined, handlers: CoreBattleHandlers): PlayerId[] {
  return additionalBattleDamagePlayers(state, player, battleCards ?? [], handlers.createContinuousContext(state));
}

export function getCoreBattleDamageReason(state: DuelState, player: PlayerId, battleCards: DuelCardInstance[] | undefined, handlers: CoreBattleHandlers): number {
  return battleDamageReason(state, player, battleCards ?? [], handlers.createContinuousContext(state));
}
