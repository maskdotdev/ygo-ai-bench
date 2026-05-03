import { resolvePendingDuelBattle } from "#duel/battle.js";
import type { DuelCardInstance, DuelEventName, DuelState, PlayerId } from "#duel/types.js";

export interface BattleEventPayload {
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
}

export interface BattleContinuationHandlers {
  additionalBattleDamagePlayers(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): PlayerId[];
  battleDamagePlayer(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): PlayerId;
  battleDamageReason(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): number;
  canAttackTarget?(state: DuelState, attacker: DuelCardInstance, target: DuelCardInstance): boolean;
  collectEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance, payload?: BattleEventPayload): void;
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
      if (state.battleDamage[damagePlayer] > 0) handlers.collectEvent(state, "beforeBattleDamage", undefined, { eventPlayer: damagePlayer, eventValue: state.battleDamage[damagePlayer], eventReason: reason });
      const applied = handlers.damagePlayer(state, damagePlayer, state.battleDamage[damagePlayer], reason);
      if (applied > 0) handlers.collectEvent(state, "battleDamageDealt", undefined, { eventPlayer: damagePlayer, eventValue: applied, eventReason: reason });
      for (const additionalPlayer of handlers.additionalBattleDamagePlayers(state, damagePlayer, battleCards)) {
        if (additionalPlayer === damagePlayer) continue;
        handlers.changeBattleDamage(state, additionalPlayer, applied, battleCards);
        const additionalReason = handlers.battleDamageReason(state, additionalPlayer, battleCards);
        if (state.battleDamage[additionalPlayer] > 0) handlers.collectEvent(state, "beforeBattleDamage", undefined, { eventPlayer: additionalPlayer, eventValue: state.battleDamage[additionalPlayer], eventReason: additionalReason });
        const additionalApplied = handlers.damagePlayer(state, additionalPlayer, state.battleDamage[additionalPlayer], additionalReason);
        if (additionalApplied > 0) handlers.collectEvent(state, "battleDamageDealt", undefined, { eventPlayer: additionalPlayer, eventValue: additionalApplied, eventReason: additionalReason });
      }
      return applied;
    },
    destroyCard: (uid, controller, reason, reasonPlayer) => handlers.destroyCard(state, uid, controller, reason, reasonPlayer),
    getAttackValue: (card) => handlers.getAttackValue(state, card),
    getDefenseValue: (card) => handlers.getDefenseValue(state, card),
    hasPiercingDamage: (card) => handlers.hasPiercingDamage(state, card),
  });
  state.waitingFor = state.pendingTriggers[0]?.player ?? state.turnPlayer;
}

export function resolvePendingBattleIfReady(state: DuelState, handlers: BattleContinuationHandlers): void {
  if (!state.pendingBattle || state.chain.length || state.pendingTriggers.length) return;
  resolvePendingBattle(state, handlers);
}
