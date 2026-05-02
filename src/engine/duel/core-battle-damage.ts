import { findCard, pushDuelLog } from "#duel/card-state.js";
import {
  changedBattleDamageAmount,
  isBattleDamagePrevented,
  isBattleDamagePreventedByCard,
  reflectedBattleDamagePlayer,
  type ContinuousEffectContextFactory,
} from "#duel/continuous-effects.js";
import type { DuelCardInstance, DuelState, PlayerId } from "#duel/types.js";

export function getDuelBattleDamage(state: DuelState, player: PlayerId): number {
  return state.battleDamage[player] ?? 0;
}

export function changeDuelBattleDamage(state: DuelState, player: PlayerId, amount: number): number {
  const value = Math.max(0, Math.floor(amount));
  state.battleDamage[player] = value;
  if (state.pendingBattle && (state.battleStep === "damage" || state.battleStep === "damageCalculation")) {
    state.pendingBattle.battleDamageOverrides = { ...state.pendingBattle.battleDamageOverrides, [player]: value };
  }
  pushDuelLog(state, "battleDamage", player, undefined, String(value));
  return value;
}

export function changeDuelBattleDamageWithPrevention(
  state: DuelState,
  player: PlayerId,
  amount: number,
  createContext: ContinuousEffectContextFactory,
  battleCards: DuelCardInstance[] = [],
): number {
  const relatedBattleCards = battleCards.length > 0 ? battleCards : currentBattleCards(state);
  const prevented = isBattleDamagePrevented(state, player, createContext);
  const preventedByCard = isBattleDamagePreventedByCard(state, player, relatedBattleCards, createContext);
  const changedAmount = changedBattleDamageAmount(state, player, amount, relatedBattleCards, createContext);
  return changeDuelBattleDamage(state, player, prevented || preventedByCard ? 0 : changedAmount);
}

export function reflectedDuelBattleDamagePlayer(
  state: DuelState,
  player: PlayerId,
  createContext: ContinuousEffectContextFactory,
  battleCards: DuelCardInstance[] = [],
): PlayerId {
  const relatedBattleCards = battleCards.length > 0 ? battleCards : currentBattleCards(state);
  return reflectedBattleDamagePlayer(state, player, relatedBattleCards, createContext);
}

function currentBattleCards(state: DuelState): DuelCardInstance[] {
  const battle = state.currentAttack ?? state.pendingBattle;
  const attacker = battle?.attackerUid ? findCard(state, battle.attackerUid) : undefined;
  const target = battle?.targetUid ? findCard(state, battle.targetUid) : undefined;
  return [attacker, target].filter((card): card is DuelCardInstance => Boolean(card));
}
