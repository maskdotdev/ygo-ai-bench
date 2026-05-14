import { currentBattleWindowKind, isBattleDamageStep } from "#duel/battle-window-state.js";
import { findCard, pushDuelLog } from "#duel/card-state.js";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import {
  changedBattleDamageAmount,
  isBattleDamagePrevented,
  isBattleDamagePreventedByCard,
  reflectedBattleDamagePlayer,
  type ContinuousEffectContextFactory,
} from "#duel/continuous-effects.js";
import { otherPlayer } from "#duel/player-id.js";
import type { DuelCardInstance, DuelState, PlayerId } from "#duel/types.js";

export interface BattleDamageChangeOptions {
  applyModifiers?: boolean;
}

export function getDuelBattleDamage(state: DuelState, player: PlayerId): number {
  const stored = state.battleDamage[player] ?? 0;
  if (stored > 0 || !state.pendingBattle || state.pendingBattle.resultApplied) return stored;
  if (state.pendingBattle.battleDamageOverrides?.[player] !== undefined) return stored;
  if (currentBattleWindowKind(state) !== "beforeDamageCalculation") return stored;
  return prospectiveBattleDamage(state, player);
}

export function changeDuelBattleDamage(state: DuelState, player: PlayerId, amount: number): number {
  const value = Math.max(0, Math.floor(amount));
  state.battleDamage[player] = value;
  if (state.pendingBattle && isBattleDamageStep(state)) {
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
  options: BattleDamageChangeOptions = {},
): number {
  const relatedBattleCards = battleCards.length > 0 ? battleCards : currentBattleCards(state);
  const prevented = isBattleDamagePrevented(state, player, createContext);
  const preventedByCard = isBattleDamagePreventedByCard(state, player, relatedBattleCards, createContext);
  const changedAmount = options.applyModifiers === false ? amount : changedBattleDamageAmount(state, player, amount, relatedBattleCards, createContext);
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

function prospectiveBattleDamage(state: DuelState, player: PlayerId): number {
  const battle = state.currentAttack ?? state.pendingBattle;
  const attacker = battle?.attackerUid ? findCard(state, battle.attackerUid) : undefined;
  if (!battle || !attacker || attacker.location !== "monsterZone") return 0;
  const target = battle.targetUid ? findCard(state, battle.targetUid) : undefined;
  if (!target) return player === otherPlayer(attacker.controller) ? currentAttack(attacker, state) : 0;
  if (target.location !== "monsterZone") return 0;
  const attackerAttack = currentAttack(attacker, state);
  const targetStat = target.position === "faceUpAttack" ? currentAttack(target, state) : currentDefense(target, state);
  if (target.position === "faceUpAttack") {
    if (attackerAttack > targetStat) return player === target.controller ? attackerAttack - targetStat : 0;
    if (attackerAttack < targetStat) return player === attacker.controller ? targetStat - attackerAttack : 0;
    return 0;
  }
  if (attackerAttack < targetStat) return player === attacker.controller ? targetStat - attackerAttack : 0;
  return 0;
}
