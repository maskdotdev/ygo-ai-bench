import { resolvePendingDuelBattle } from "#duel/battle.js";
import { setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";
import type { DuelCardInstance, DuelEventName, DuelState, PlayerId } from "#duel/types.js";

export interface BattleEventPayload {
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
}

export interface BattleContinuationHandlers {
  additionalBattleDamagePlayers(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): PlayerId[];
  battleDamagePlayer(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): PlayerId;
  battleDamageReason(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): number;
  canAttackTarget?(state: DuelState, attacker: DuelCardInstance, target: DuelCardInstance): boolean;
  collectEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance | DuelCardInstance[], payload?: BattleEventPayload): void;
  changeBattleDamage(state: DuelState, player: PlayerId, amount: number, battleCards?: DuelCardInstance[]): number;
  damagePlayer(state: DuelState, player: PlayerId, amount: number, reason?: number): number;
  destroyCard(state: DuelState, uid: string, controller?: PlayerId, reason?: number, reasonPlayer?: PlayerId): DuelCardInstance;
  getAttackValue(state: DuelState, card: DuelCardInstance): number;
  getDefenseValue(state: DuelState, card: DuelCardInstance): number;
  hasPiercingDamage(state: DuelState, card: DuelCardInstance): boolean;
}

export function resolvePendingBattle(state: DuelState, handlers: BattleContinuationHandlers): void {
  const battleDamageOverrides = state.pendingBattle?.battleDamageOverrides;
  resolvePendingDuelBattle(state, {
    canAttackTarget: (attacker, target) => handlers.canAttackTarget?.(state, attacker, target) ?? true,
    collectEvent: (eventName, eventCard) => handlers.collectEvent(state, eventName, eventCard),
    damagePlayer: (damagedPlayer, amount, battleCards) => {
      const adjustedAmount = battleDamageOverrides?.[damagedPlayer] ?? amount;
      const damagePlayer = handlers.battleDamagePlayer(state, damagedPlayer, battleCards);
      if (damagePlayer !== damagedPlayer) handlers.changeBattleDamage(state, damagedPlayer, 0, battleCards);
      handlers.changeBattleDamage(state, damagePlayer, adjustedAmount, battleCards);
      const reason = handlers.battleDamageReason(state, damagePlayer, battleCards);
      const reasonPlayer = battleDamageReasonPlayer(state, damagePlayer, battleCards);
      const damageSource = battleDamageSourceCard(reasonPlayer, battleCards);
      if (state.battleDamage[damagePlayer] > 0) handlers.collectEvent(state, "beforeBattleDamage", damageSource, { eventPlayer: damagePlayer, eventValue: state.battleDamage[damagePlayer], eventReason: reason, eventReasonPlayer: reasonPlayer });
      const applied = handlers.damagePlayer(state, damagePlayer, state.battleDamage[damagePlayer], reason);
      if (duelHasEnded(state)) return applied;
      if (applied > 0) handlers.collectEvent(state, "battleDamageDealt", damageSource, { eventPlayer: damagePlayer, eventValue: applied, eventReason: reason, eventReasonPlayer: reasonPlayer });
      for (const additionalPlayer of handlers.additionalBattleDamagePlayers(state, damagePlayer, battleCards)) {
        if (additionalPlayer === damagePlayer) continue;
        handlers.changeBattleDamage(state, additionalPlayer, applied, battleCards);
        const additionalReason = handlers.battleDamageReason(state, additionalPlayer, battleCards);
        const additionalReasonPlayer = battleDamageReasonPlayer(state, additionalPlayer, battleCards);
        const additionalDamageSource = battleDamageSourceCard(additionalReasonPlayer, battleCards);
        if (state.battleDamage[additionalPlayer] > 0) handlers.collectEvent(state, "beforeBattleDamage", additionalDamageSource, { eventPlayer: additionalPlayer, eventValue: state.battleDamage[additionalPlayer], eventReason: additionalReason, eventReasonPlayer: additionalReasonPlayer });
        const additionalApplied = handlers.damagePlayer(state, additionalPlayer, state.battleDamage[additionalPlayer], additionalReason);
        if (duelHasEnded(state)) return applied;
        if (additionalApplied > 0) handlers.collectEvent(state, "battleDamageDealt", additionalDamageSource, { eventPlayer: additionalPlayer, eventValue: additionalApplied, eventReason: additionalReason, eventReasonPlayer: additionalReasonPlayer });
      }
      return applied;
    },
    destroyCard: (uid, controller, reason, reasonPlayer) => handlers.destroyCard(state, uid, controller, reason, reasonPlayer),
    getAttackValue: (card) => handlers.getAttackValue(state, card),
    getDefenseValue: (card) => handlers.getDefenseValue(state, card),
    hasPiercingDamage: (card) => handlers.hasPiercingDamage(state, card),
  });
  if (duelHasEnded(state)) return;
  setWaitingForPendingTriggerBucket(state);
}

export function resolvePendingBattleIfReady(state: DuelState, handlers: BattleContinuationHandlers): void {
  if (!state.pendingBattle || state.chain.length || state.pendingTriggers.length) return;
  resolvePendingBattle(state, handlers);
}

function duelHasEnded(state: DuelState): boolean {
  return (state as { status: string }).status === "ended";
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
