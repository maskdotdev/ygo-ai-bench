import { resolvePendingDuelBattle } from "#duel/battle.js";
import type { DuelCardInstance, DuelEventName, DuelState, PlayerId } from "#duel/types.js";

export interface BattleContinuationHandlers {
  collectEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void;
  changeBattleDamage(state: DuelState, player: PlayerId, amount: number): number;
  damagePlayer(state: DuelState, player: PlayerId, amount: number): number;
  destroyCard(state: DuelState, uid: string, controller?: PlayerId, reason?: number): DuelCardInstance;
}

export function resolvePendingBattle(state: DuelState, handlers: BattleContinuationHandlers): void {
  const battleDamageOverrides = state.pendingBattle?.battleDamageOverrides;
  resolvePendingDuelBattle(state, {
    collectEvent: (eventName, eventCard) => handlers.collectEvent(state, eventName, eventCard),
    damagePlayer: (damagedPlayer, amount) => {
      handlers.changeBattleDamage(state, damagedPlayer, battleDamageOverrides?.[damagedPlayer] ?? amount);
      return handlers.damagePlayer(state, damagedPlayer, state.battleDamage[damagedPlayer]);
    },
    destroyCard: (uid, controller, reason) => handlers.destroyCard(state, uid, controller, reason),
  });
  state.waitingFor = state.pendingTriggers[0]?.player ?? state.turnPlayer;
}

export function resolvePendingBattleIfReady(state: DuelState, handlers: BattleContinuationHandlers): void {
  if (!state.pendingBattle || state.chain.length || state.pendingTriggers.length) return;
  resolvePendingBattle(state, handlers);
}
