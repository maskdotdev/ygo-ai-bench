import { resolvePendingDuelBattle, type ResolvePendingDuelBattleOptions } from "#duel/battle.js";
import type { DuelEventPayload } from "#duel/event-history.js";
import { otherPlayer } from "#duel/player-id.js";
import { setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";
import type { BattleDamageChangeOptions } from "#duel/core-battle-damage.js";
import type { DuelCardInstance, DuelEventName, DuelState, PlayerId } from "#duel/types.js";

interface PreparedBattleDamage {
  amount: number;
  damagePlayer: PlayerId;
  damageSource: DuelCardInstance | undefined;
  reason: number;
  reasonEffectId?: number;
  reasonPlayer: PlayerId;
}

export interface BattleEventPayload {
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
}

export interface BattleContinuationHandlers {
  additionalBattleDamagePlayers(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): PlayerId[];
  battleDamagePlayer(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): PlayerId;
  battleDamageReason(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): number;
  battleDamageReasonEffectId?(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): number | undefined;
  canAttackTarget?(state: DuelState, attacker: DuelCardInstance, target: DuelCardInstance): boolean;
  collectEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance | DuelCardInstance[], payload?: BattleEventPayload): void;
  changeBattleDamage(state: DuelState, player: PlayerId, amount: number, battleCards?: DuelCardInstance[], options?: BattleDamageChangeOptions): number;
  damagePlayer(state: DuelState, player: PlayerId, amount: number, reason?: number): number;
  destroyCard(state: DuelState, uid: string, controller?: PlayerId, reason?: number, reasonPlayer?: PlayerId): DuelCardInstance;
  preventDestroyCard?(state: DuelState, uid: string, controller: PlayerId | undefined, reason: number, reasonPlayer: PlayerId | undefined, payload?: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId">): DuelCardInstance | undefined;
  getAttackValue(state: DuelState, card: DuelCardInstance): number;
  getDefenseValue(state: DuelState, card: DuelCardInstance): number;
  hasPiercingDamage(state: DuelState, card: DuelCardInstance): boolean;
  hasQuickEffectResponses?(state: DuelState, player: PlayerId): boolean;
}

export function resolvePendingBattle(state: DuelState, handlers: BattleContinuationHandlers, options: ResolvePendingDuelBattleOptions = {}): void {
  const battleDamageOverrides = state.pendingBattle?.battleDamageOverrides;
  const prepareBattleDamage = (damagedPlayer: PlayerId, amount: number, battleCards: DuelCardInstance[] | undefined): PreparedBattleDamage => {
    const adjustedAmount = battleDamageOverrides?.[damagedPlayer] ?? amount;
    const damagePlayer = handlers.battleDamagePlayer(state, damagedPlayer, battleCards);
    if (damagePlayer !== damagedPlayer) handlers.changeBattleDamage(state, damagedPlayer, 0, battleCards);
    handlers.changeBattleDamage(state, damagePlayer, adjustedAmount, battleCards);
    return describeBattleDamage(state, handlers, damagePlayer, battleCards);
  };
  const applyBattleDamage = (damage: PreparedBattleDamage): number => {
    if (damage.amount > 0) {
      handlers.collectEvent(state, "beforeBattleDamage", damage.damageSource, battleDamageEventPayload(damage, damage.amount));
    }
    const applied = applyBattleDamageOnly(damage);
    if (!duelHasEnded(state) && applied > 0) {
      handlers.collectEvent(state, "battleDamageDealt", damage.damageSource, battleDamageEventPayload(damage, applied));
    }
    return applied;
  };
  const applyBattleDamageOnly = (damage: PreparedBattleDamage): number => {
    return handlers.damagePlayer(state, damage.damagePlayer, damage.amount, damage.reason);
  };
  const collectBattleDamageEvents = (damage: PreparedBattleDamage, dealtAmount: number): void => {
    if (damage.amount > 0) {
      handlers.collectEvent(state, "beforeBattleDamage", damage.damageSource, battleDamageEventPayload(damage, damage.amount));
    }
    if (dealtAmount > 0) {
      handlers.collectEvent(state, "battleDamageDealt", damage.damageSource, battleDamageEventPayload(damage, dealtAmount));
    }
  };
  const changeAdditionalBattleDamage = (damagePlayer: PlayerId, amount: number, battleCards: DuelCardInstance[] | undefined): void => {
    for (const additionalPlayer of handlers.additionalBattleDamagePlayers(state, damagePlayer, battleCards)) {
      if (additionalPlayer === damagePlayer) continue;
      handlers.changeBattleDamage(state, additionalPlayer, amount, battleCards, { applyModifiers: false });
    }
  };
  const applyAdditionalBattleDamage = (damagePlayer: PlayerId, applied: number, battleCards: DuelCardInstance[] | undefined): void => {
    changeAdditionalBattleDamage(damagePlayer, applied, battleCards);
    for (const additionalPlayer of handlers.additionalBattleDamagePlayers(state, damagePlayer, battleCards)) {
      if (additionalPlayer === damagePlayer) continue;
      applyBattleDamage(describeBattleDamage(state, handlers, additionalPlayer, battleCards));
      if (duelHasEnded(state)) return;
    }
  };
  const applyAdditionalBattleDamageOnly = (damagePlayer: PlayerId, applied: number, battleCards: DuelCardInstance[] | undefined): void => {
    changeAdditionalBattleDamage(damagePlayer, applied, battleCards);
    for (const additionalPlayer of handlers.additionalBattleDamagePlayers(state, damagePlayer, battleCards)) {
      if (additionalPlayer === damagePlayer) continue;
      applyBattleDamageOnly(describeBattleDamage(state, handlers, additionalPlayer, battleCards));
      if (duelHasEnded(state)) return;
    }
  };
  const eventHistoryLength = state.eventHistory.length;
  resolvePendingDuelBattle(state, {
    canAttackTarget: (attacker, target) => handlers.canAttackTarget?.(state, attacker, target) ?? true,
    applyStoredBattleDamage: (battleCards) => {
      let appliedAny = false;
      for (const player of [0, 1] as PlayerId[]) {
        const damage = describeBattleDamage(state, handlers, player, battleCards);
        if (damage.amount <= 0) continue;
        collectBattleDamageEvents(damage, damage.amount);
        appliedAny = true;
      }
      return appliedAny;
    },
    changeBattleDamage: (damagedPlayer, amount, battleCards) => {
      const damage = prepareBattleDamage(damagedPlayer, amount, battleCards);
      const applied = applyBattleDamageOnly(damage);
      if (!duelHasEnded(state)) applyAdditionalBattleDamageOnly(damage.damagePlayer, applied, battleCards);
      return damage.amount;
    },
    collectEvent: (eventName, eventCard) => handlers.collectEvent(state, eventName, eventCard),
    damagePlayer: (damagedPlayer, amount, battleCards) => {
      const damage = prepareBattleDamage(damagedPlayer, amount, battleCards);
      const applied = applyBattleDamage(damage);
      if (duelHasEnded(state)) return applied;
      applyAdditionalBattleDamage(damage.damagePlayer, applied, battleCards);
      return applied;
    },
    destroyCard: (uid, controller, reason, reasonPlayer) => handlers.destroyCard(state, uid, controller, reason, reasonPlayer),
    preventDestroyCard: (uid, controller, reason, reasonPlayer, payload) => handlers.preventDestroyCard?.(state, uid, controller, reason, reasonPlayer, payload),
    getAttackValue: (card) => handlers.getAttackValue(state, card),
    getDefenseValue: (card) => handlers.getDefenseValue(state, card),
    hasPiercingDamage: (card) => handlers.hasPiercingDamage(state, card),
  }, options);
  if (duelHasEnded(state)) return;
  setWaitingForPendingTriggerBucket(state);
  if (state.pendingTriggers.length === 0 && collectedBattleDestroyedSince(state, eventHistoryLength)) setWaitingForBattleDestroyedQuickResponse(state, handlers);
}

export function resolvePendingBattleIfReady(state: DuelState, handlers: BattleContinuationHandlers): void {
  if (!state.pendingBattle || state.chain.length || state.pendingTriggers.length) return;
  resolvePendingBattle(state, handlers);
}

function duelHasEnded(state: DuelState): boolean {
  return (state as { status: string }).status === "ended";
}

function collectedBattleDestroyedSince(state: DuelState, eventHistoryLength: number): boolean {
  return state.eventHistory.slice(eventHistoryLength).some((event) => event.eventName === "battleDestroyed");
}

function setWaitingForBattleDestroyedQuickResponse(state: DuelState, handlers: BattleContinuationHandlers): void {
  if (!handlers.hasQuickEffectResponses) return;
  const players: PlayerId[] = [state.turnPlayer, otherPlayer(state.turnPlayer)];
  for (const player of players) {
    if (!handlers.hasQuickEffectResponses(state, player)) continue;
    state.waitingFor = player;
    return;
  }
}

function describeBattleDamage(state: DuelState, handlers: BattleContinuationHandlers, damagePlayer: PlayerId, battleCards: DuelCardInstance[] | undefined): PreparedBattleDamage {
  const reason = handlers.battleDamageReason(state, damagePlayer, battleCards);
  const reasonPlayer = battleDamageReasonPlayer(state, damagePlayer, battleCards);
  const reasonEffectId = handlers.battleDamageReasonEffectId?.(state, damagePlayer, battleCards);
  return {
    amount: state.battleDamage[damagePlayer] ?? 0,
    damagePlayer,
    damageSource: battleDamageSourceCard(reasonPlayer, battleCards),
    reason,
    ...(reasonEffectId === undefined ? {} : { reasonEffectId }),
    reasonPlayer,
  };
}

function battleDamageEventPayload(damage: PreparedBattleDamage, amount: number): BattleEventPayload {
  return {
    eventPlayer: damage.damagePlayer,
    eventValue: amount,
    eventReason: damage.reason,
    eventReasonPlayer: damage.reasonPlayer,
    ...(damage.damageSource === undefined ? {} : { eventReasonCardUid: damage.damageSource.uid }),
    ...(damage.reasonEffectId === undefined ? {} : { eventReasonEffectId: damage.reasonEffectId }),
  };
}

function battleDamageReasonPlayer(state: DuelState, damagedPlayer: PlayerId, battleCards: DuelCardInstance[] | undefined): PlayerId {
  const attacker = battleCards?.[0];
  const target = battleCards?.[1];
  if (target && damagedPlayer === attacker?.controller) return target.controller;
  return attacker?.controller ?? state.turnPlayer;
}

function battleDamageSourceCard(reasonPlayer: PlayerId, battleCards: DuelCardInstance[] | undefined): DuelCardInstance | undefined {
  return battleCards?.find((card) => card.controller === reasonPlayer) ?? battleCards?.[0];
}
