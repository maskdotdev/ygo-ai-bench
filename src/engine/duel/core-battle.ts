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
  extraAttackCount,
  isAttackPrevented,
  isBattleTargetPrevented,
  type ContinuousEffectContextFactory,
} from "#duel/continuous-effects.js";
import type { CardPosition, DuelAction, DuelCardInstance, DuelEventName, DuelState, PlayerId } from "#duel/types.js";

export interface CoreBattleHandlers {
  changeBattleDamage(state: DuelState, player: PlayerId, amount: number): number;
  collectEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void;
  createContinuousContext(state: DuelState): ContinuousEffectContextFactory;
  damagePlayer(state: DuelState, player: PlayerId, amount: number): number;
  destroyCard(state: DuelState, uid: string, controller?: PlayerId, reason?: number, reasonPlayer?: PlayerId): DuelCardInstance;
}

export function appendBattleActions(actions: DuelAction[], state: DuelState, player: PlayerId, handlers: CoreBattleHandlers): void {
  if (state.phase !== "battle") return;
  const createContext = handlers.createContinuousContext(state);
  for (const action of attackActions(
    state,
    player,
    (card) => extraAttackCount(state, card, createContext),
    (card) => !isBattleTargetPrevented(state, card, createContext),
  )) {
    if (action.type !== "declareAttack") continue;
    const attacker = findCard(state, action.attackerUid);
    if (attacker && !isAttackPrevented(state, attacker, createContext)) actions.push(action);
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
    (target) => !isBattleTargetPrevented(state, target, createContext),
  );
}

export function declareCoreDuelAttack(state: DuelState, player: PlayerId, attackerUid: string, targetUid: string | undefined, handlers: CoreBattleHandlers): void {
  const attacker = findCard(state, attackerUid);
  const createContext = handlers.createContinuousContext(state);
  if (attacker && isAttackPrevented(state, attacker, createContext)) throw new Error(`${attacker.name} cannot attack`);
  state.battleDamage = { 0: 0, 1: 0 };
  const pendingTriggerCount = state.pendingTriggers.length;
  declareDuelAttackRule(state, player, attackerUid, targetUid, {
    collectEvent: (eventName, eventCard) => handlers.collectEvent(state, eventName, eventCard),
    damagePlayer: (damagedPlayer, amount) => {
      handlers.changeBattleDamage(state, damagedPlayer, amount);
      return handlers.damagePlayer(state, damagedPlayer, state.battleDamage[damagedPlayer]);
    },
    destroyCard: (uid, controller, reason, reasonPlayer) => handlers.destroyCard(state, uid, controller, reason, reasonPlayer),
  }, attacker ? extraAttackCount(state, attacker, createContext) : 0, (target) => !isBattleTargetPrevented(state, target, createContext));
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
