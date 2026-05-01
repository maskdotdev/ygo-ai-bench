import { resolvePendingDuelBattle } from "#duel/battle.js";
import type { DuelCardInstance, DuelEventName, DuelState, PlayerId } from "#duel/types.js";

export interface BattleContinuationHandlers {
  battleDamagePlayer(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): PlayerId;
  collectEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance): void;
  changeBattleDamage(state: DuelState, player: PlayerId, amount: number, battleCards?: DuelCardInstance[]): number;
  damagePlayer(state: DuelState, player: PlayerId, amount: number): number;
  destroyCard(state: DuelState, uid: string, controller?: PlayerId, reason?: number, reasonPlayer?: PlayerId): DuelCardInstance;
}

export function resolvePendingBattle(state: DuelState, handlers: BattleContinuationHandlers): void {
  const battleDamageOverrides = state.pendingBattle?.battleDamageOverrides;
  resolvePendingDuelBattle(state, {
    collectEvent: (eventName, eventCard) => handlers.collectEvent(state, eventName, eventCard),
    damagePlayer: (damagedPlayer, amount, battleCards) => {
      const adjustedAmount = battleDamageOverrides?.[damagedPlayer] ?? amount;
      const damagePlayer = handlers.battleDamagePlayer(state, damagedPlayer, battleCards);
      if (damagePlayer !== damagedPlayer) handlers.changeBattleDamage(state, damagedPlayer, 0, battleCards);
      handlers.changeBattleDamage(state, damagePlayer, adjustedAmount, battleCards);
      return handlers.damagePlayer(state, damagePlayer, state.battleDamage[damagePlayer]);
    },
    destroyCard: (uid, controller, reason, reasonPlayer) => handlers.destroyCard(state, uid, controller, reason, reasonPlayer),
  });
  state.waitingFor = state.pendingTriggers[0]?.player ?? state.turnPlayer;
}

export function resolvePendingBattleIfReady(state: DuelState, handlers: BattleContinuationHandlers): void {
  if (!state.pendingBattle || state.chain.length || state.pendingTriggers.length) return;
  resolvePendingBattle(state, handlers);
}
