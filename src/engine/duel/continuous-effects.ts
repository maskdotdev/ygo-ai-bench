import { findCard } from "#duel/card-state.js";
import { otherPlayer } from "#duel/player-id.js";
import { hasReviveLimitProcedureComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import { effectiveSpecialSummonTypeCode } from "#duel/summon-type-codes.js";
import type {
  DuelCardInstance,
  DuelEffectContext,
  DuelEffectDefinition,
  DuelLocation,
  DuelState,
  DuelSummonType,
  PlayerId,
} from "#duel/types.js";

export type ContinuousEffectContextFactory = (
  effect: DuelEffectDefinition,
  source: DuelCardInstance,
  card?: DuelCardInstance,
) => DuelEffectContext;

export interface ContinuousEffectMatch {
  effect: DuelEffectDefinition;
  source: DuelCardInstance;
  card: DuelCardInstance;
}

export interface RedirectDestination {
  location: DuelLocation;
  deckSequence?: number;
}

export type MaterialUseKind = "fusion" | "synchro" | "xyz" | "link" | "ritual";

export function isEffectActivationPrevented(
  state: DuelState,
  player: PlayerId,
  card: DuelCardInstance,
  createContext: ContinuousEffectContextFactory,
  activatingEffect?: DuelEffectDefinition,
): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 6) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    const relatedEffectId = luaRelatedEffectId(activatingEffect);
    if (relatedEffectId !== undefined) ctx.relatedEffectId = relatedEffectId;
    if (!continuousEffectTargetsPlayer(effect, source, player) && !continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (effect.targetCardPredicate && !effect.targetCardPredicate(ctx, card)) continue;
    if (effect.valuePredicate && !effect.valuePredicate(ctx, player)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

function luaRelatedEffectId(effect: DuelEffectDefinition | undefined): number | undefined {
  const id = Number(effect?.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? id : undefined;
}

export function isChainLinkNegationPrevented(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || (effect.code !== 12 && effect.code !== 13)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isCounterPlacementPrevented(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 58) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isDisablePrevented(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 3) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isControlChangePrevented(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 5) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isSpecialSummonPrevented(
  state: DuelState,
  player: PlayerId,
  createContext: ContinuousEffectContextFactory,
  card?: DuelCardInstance,
  summonTypeCode?: number,
  relatedEffectId?: number,
): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 22) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectTargetsPlayer(effect, source, player)) continue;
    const ctx = createContext(effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  if (card && isReviveLimitSpecialSummonPrevented(state, card)) return true;
  if (card && isSpecialSummonConditionPrevented(state, player, createContext, card, summonTypeCode, relatedEffectId)) return true;
  return false;
}

function isReviveLimitSpecialSummonPrevented(state: DuelState, card: DuelCardInstance): boolean {
  if (card.location !== "graveyard" && card.location !== "banished") return false;
  if (hasReviveLimitProcedureComplete(card)) return false;
  for (const effect of state.effects) {
    if (effect.event === "continuous" && effect.code === 31 && effect.sourceUid === card.uid && findCard(state, effect.sourceUid)) return true;
  }
  return false;
}

function isSpecialSummonConditionPrevented(
  state: DuelState,
  player: PlayerId,
  createContext: ContinuousEffectContextFactory,
  card: DuelCardInstance,
  summonTypeCode?: number,
  relatedEffectId?: number,
): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 30 || effect.sourceUid !== card.uid) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source) continue;
    const ctx = createContext(effect, source, card);
    ctx.summonTypeCode = effectiveSpecialSummonTypeCode(summonTypeCode);
    if (relatedEffectId !== undefined) ctx.relatedEffectId = relatedEffectId;
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    if (!effect.valuePredicate) return true;
    if (!effect.valuePredicate(ctx, player)) return true;
  }
  return false;
}

export function isSummonNegationPrevented(state: DuelState, card: DuelCardInstance, summonType: DuelSummonType, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !isSummonNegationCode(effect.code, summonType)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isDrawPrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 25) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectTargetsPlayer(effect, source, player)) continue;
    const ctx = createContext(effect, source);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isHandDiscardPrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory): boolean {
  return isPlayerActionPrevented(state, player, 55, createContext);
}

export function isDeckDiscardPrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory): boolean {
  return isPlayerActionPrevented(state, player, 56, createContext);
}

export function isLifePointLossDefeatPrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory): boolean {
  return isPlayerActionPrevented(state, player, 401, createContext);
}

export function isDeckLossDefeatPrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory): boolean {
  return isPlayerActionPrevented(state, player, 400, createContext);
}

export function isEffectDefeatPrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory): boolean {
  return isPlayerActionPrevented(state, player, 402, createContext);
}

export function isFlipSummonPrevented(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 21) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isNormalSummonPrevented(state: DuelState, player: PlayerId, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  return isSummonOrSetPrevented(state, player, card, 20, createContext);
}

export function isMonsterSetPrevented(state: DuelState, player: PlayerId, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  return isSummonOrSetPrevented(state, player, card, 23, createContext);
}

export function isSpellTrapSetPrevented(state: DuelState, player: PlayerId, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  return isSummonOrSetPrevented(state, player, card, 24, createContext);
}

export function isPhaseEntryPrevented(state: DuelState, player: PlayerId, phase: "battle" | "main2" | "end", createContext: ContinuousEffectContextFactory): boolean {
  const codes = phase === "battle" ? [183, 185] : phase === "main2" ? [184, 186] : [189, 187];
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !codes.includes(effect.code ?? -1)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectTargetsPlayer(effect, source, player)) continue;
    const ctx = createContext(effect, source);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isPositionChangePrevented(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 14) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isTurnSetPrevented(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 69) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isEffectPositionChangePrevented(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 87) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

function isPlayerActionPrevented(state: DuelState, player: PlayerId, code: number, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== code) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectTargetsPlayer(effect, source, player)) continue;
    const ctx = createContext(effect, source);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

function isSummonOrSetPrevented(state: DuelState, player: PlayerId, card: DuelCardInstance, code: number, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== code) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectTargetsPlayer(effect, source, player) && !continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (effect.targetCardPredicate && !effect.targetCardPredicate(ctx, card)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function matchingPlayerEffects(
  state: DuelState,
  player: PlayerId,
  code: number,
  createContext: ContinuousEffectContextFactory,
): ContinuousEffectMatch[] {
  const matches: ContinuousEffectMatch[] = [];
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== code) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectTargetsPlayer(effect, source, player)) continue;
    const ctx = createContext(effect, source);
    if (!effect.canActivate || effect.canActivate(ctx)) matches.push({ effect, source, card: source });
  }
  return matches;
}

export function isBattleDamagePrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory): boolean {
  return matchingPlayerEffects(state, player, 201, createContext).length > 0;
}

export function isBattleDamagePreventedByCard(state: DuelState, player: PlayerId, battleCards: DuelCardInstance[], createContext: ContinuousEffectContextFactory): boolean {
  for (const card of battleCards) {
    for (const effect of state.effects) {
      if (effect.event !== "continuous" || (effect.code !== 200 && effect.code !== 201) || effect.sourceUid !== card.uid) continue;
      const source = findCard(state, effect.sourceUid);
      if (!source || !effect.range.includes(source.location)) continue;
      if (effect.code === 201 && player !== source.controller) continue;
      if (effect.code === 200 && effect.value !== 1 && player === source.controller) continue;
      const ctx = createContext(effect, source, card);
      if (!effect.canActivate || effect.canActivate(ctx)) return true;
    }
  }
  return false;
}

export function changedBattleDamageAmount(state: DuelState, player: PlayerId, amount: number, battleCards: DuelCardInstance[], createContext: ContinuousEffectContextFactory): number {
  let value = amount;
  for (const card of battleCards) {
    for (const effect of state.effects) {
      if (effect.event !== "continuous" || effect.code !== 208 || effect.sourceUid !== card.uid) continue;
      const source = findCard(state, effect.sourceUid);
      if (!source || !effect.range.includes(source.location)) continue;
      const ctx = createContext(effect, source, card);
      if (effect.canActivate && !effect.canActivate(ctx)) continue;
      const next = effect.battleDamageValue?.(ctx, player) ?? effect.value;
      value = applyBattleDamageValue(value, next);
    }
  }
  return value;
}

export function reflectedBattleDamagePlayer(state: DuelState, player: PlayerId, battleCards: DuelCardInstance[], createContext: ContinuousEffectContextFactory): PlayerId {
  for (const card of battleCards) {
    for (const effect of state.effects) {
      if (effect.event !== "continuous" || effect.code !== 202) continue;
      const source = findCard(state, effect.sourceUid);
      if (!source || !effect.range.includes(source.location)) continue;
      if (effect.sourceUid === card.uid && player !== source.controller) continue;
      if (effect.sourceUid !== card.uid && !continuousEffectTargetsPlayer(effect, source, player)) continue;
      const ctx = createContext(effect, source, card);
      if (!effect.canActivate || effect.canActivate(ctx)) return otherPlayer(player);
    }
  }
  return player;
}

export function hasPiercingBattleDamage(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 203) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function additionalBattleDamagePlayers(state: DuelState, player: PlayerId, battleCards: DuelCardInstance[], createContext: ContinuousEffectContextFactory): PlayerId[] {
  const players = new Set<PlayerId>();
  for (const card of battleCards) {
    for (const effect of state.effects) {
      if (effect.event !== "continuous" || (effect.code !== 206 && effect.code !== 207) || effect.sourceUid !== card.uid) continue;
      const source = findCard(state, effect.sourceUid);
      if (!source || !effect.range.includes(source.location)) continue;
      if (effect.code === 207 && player !== source.controller) continue;
      const ctx = createContext(effect, source, card);
      if (!effect.canActivate || effect.canActivate(ctx)) players.add(otherPlayer(player));
    }
  }
  return [...players];
}

export function battleDamageReason(state: DuelState, player: PlayerId, battleCards: DuelCardInstance[], createContext: ContinuousEffectContextFactory): number {
  for (const card of battleCards) {
    for (const effect of state.effects) {
      if (effect.event !== "continuous" || effect.code !== 205 || effect.sourceUid !== card.uid) continue;
      const source = findCard(state, effect.sourceUid);
      if (!source || !effect.range.includes(source.location)) continue;
      if (player === source.controller) continue;
      const ctx = createContext(effect, source, card);
      if (!effect.canActivate || effect.canActivate(ctx)) return duelReason.effect;
    }
  }
  return duelReason.battle;
}

export function hasDefenseAttack(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 190) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function battleDestroyRedirectLocation(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): RedirectDestination | undefined {
  const card = findCard(state, uid);
  if (!card) return undefined;
  const battle = state.currentAttack ?? state.pendingBattle;
  const battlingUids = [battle?.attackerUid, battle?.targetUid].filter((id): id is string => Boolean(id));
  const battleOpponent = battlingUids.find((id) => id !== uid);
  const destroyer = battleOpponent ? findCard(state, battleOpponent) : undefined;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 204) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const redirect = redirectDestinationFromValue(effect.value);
    if (!redirect) continue;
    const ctx = createContext(effect, source, card);
    const destroyerCtx = destroyer ? createContext(effect, source, destroyer) : undefined;
    const sourceDestroyedOpponent = destroyer && source.uid === destroyer.uid && continuousEffectAppliesToCard(effect, source, destroyer, destroyerCtx!);
    const fieldEffectTargetsDestroyer = destroyer && source.uid !== destroyer.uid && continuousEffectAppliesToCard(effect, source, destroyer, destroyerCtx!);
    if (!sourceDestroyedOpponent && !fieldEffectTargetsDestroyer && !continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return redirect;
  }
  return undefined;
}

export function isAttackPrevented(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || (effect.code !== 85 && effect.code !== 86)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

function applyBattleDamageValue(amount: number, value: number | undefined): number {
  if (value === undefined || value < 0) return amount;
  if (value === 0x80000000) return amount * 2;
  if (value === 0x80000001) return Math.floor(amount / 2);
  return value;
}

function opponentMonsterCount(state: DuelState, player: PlayerId): number {
  return state.cards.filter((card) => card.controller === otherPlayer(player) && card.location === "monsterZone").length;
}

function attackCount(state: DuelState, uid: string): number {
  return state.attacksDeclared.filter((attackerUid) => attackerUid === uid).length;
}

export function isBattleTargetPrevented(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 70) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isBattleTargetSelectionPrevented(state: DuelState, player: PlayerId, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 332) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectTargetsPlayer(effect, source, player)) continue;
    const ctx = createContext(effect, source, card);
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    if (effect.valueCardPredicate && !effect.valueCardPredicate(ctx, card)) continue;
    return true;
  }
  return false;
}

export function isEffectTargetSelectionPrevented(state: DuelState, player: PlayerId, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 333) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectTargetsPlayer(effect, source, player)) continue;
    const ctx = createContext(effect, source, card);
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    if (effect.valueCardPredicate && !effect.valueCardPredicate(ctx, card)) continue;
    return true;
  }
  return false;
}

export function isDirectAttackPrevented(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 73) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function canDirectAttackThroughTargets(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 74) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function mustAttackMonsterTargetAllowed(
  state: DuelState,
  attacker: DuelCardInstance,
  target: DuelCardInstance,
  createContext: ContinuousEffectContextFactory,
): boolean {
  let hasRestriction = false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 344) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, target);
    if (!continuousEffectAppliesToCard(effect, source, attacker, ctx)) continue;
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    hasRestriction = true;
    if (!effect.valueCardPredicate || effect.valueCardPredicate(ctx, target)) return true;
  }
  return !hasRestriction;
}

export function hasMustAttackMonsterRestriction(state: DuelState, attacker: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 344) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, attacker);
    if (!continuousEffectAppliesToCard(effect, source, attacker, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function hasOnlyAttackMonsterRestriction(state: DuelState, attacker: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 343) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, attacker);
    if (!continuousEffectAppliesToCard(effect, source, attacker, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function onlyBeAttackedTargetUids(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory): Set<string> {
  const targetUids = new Set<string>();
  for (const card of state.cards) {
    if (card.location !== "monsterZone" || card.controller === player) continue;
    for (const effect of state.effects) {
      if (effect.event !== "continuous" || effect.code !== 196) continue;
      const source = findCard(state, effect.sourceUid);
      if (!source || !effect.range.includes(source.location)) continue;
      const ctx = createContext(effect, source, card);
      if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
      if (!effect.canActivate || effect.canActivate(ctx)) targetUids.add(card.uid);
    }
  }
  return targetUids;
}

export function firstAttackRequiredUids(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory): Set<string> {
  const attackerUids = new Set<string>();
  for (const card of state.cards) {
    if (card.location !== "monsterZone" || card.controller !== player || state.attacksDeclared.includes(card.uid)) continue;
    for (const effect of state.effects) {
      if (effect.event !== "continuous" || effect.code !== 192) continue;
      const source = findCard(state, effect.sourceUid);
      if (!source || !effect.range.includes(source.location)) continue;
      const ctx = createContext(effect, source, card);
      if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
      if (!effect.canActivate || effect.canActivate(ctx)) attackerUids.add(card.uid);
    }
  }
  return attackerUids;
}

export function mustAttackRequiredUids(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory): Set<string> {
  const attackerUids = new Set<string>();
  for (const card of state.cards) {
    if (card.location !== "monsterZone" || card.controller !== player || state.attacksDeclared.includes(card.uid)) continue;
    for (const effect of state.effects) {
      if (effect.event !== "continuous" || effect.code !== 191) continue;
      const source = findCard(state, effect.sourceUid);
      if (!source || !effect.range.includes(source.location)) continue;
      const ctx = createContext(effect, source, card);
      if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
      if (!effect.canActivate || effect.canActivate(ctx)) attackerUids.add(card.uid);
    }
  }
  return attackerUids;
}

export function extraAttackCount(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): number {
  let count = 0;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 194) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) count += Math.max(1, effect.value ?? 1);
  }
  return count;
}

export function extraMonsterAttackCount(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): number {
  let count = 0;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 346) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) count += Math.max(1, effect.value ?? 1);
  }
  return count;
}

export function attackAllMonsterCount(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): number {
  let count = 0;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 193) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) count = Math.max(count, opponentMonsterCount(state, card.controller) + attackCount(state, card.uid));
  }
  return count;
}

export function isCardDisabled(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  if (isDisablePrevented(state, card, createContext)) return false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 2) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function shouldRedirectToGraveyardMove(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): boolean {
  return moveDestinationRedirectLocation(state, uid, "graveyard", createContext)?.location === "banished";
}

export function shouldRedirectBanishMove(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): boolean {
  return moveDestinationRedirectLocation(state, uid, "banished", createContext)?.location === "graveyard";
}

export function moveDestinationRedirectLocation(
  state: DuelState,
  uid: string,
  destination: DuelLocation,
  createContext: ContinuousEffectContextFactory,
): RedirectDestination | undefined {
  const card = findCard(state, uid);
  if (!card) return undefined;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !isDestinationRedirectCode(effect.code, destination)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const redirect = redirectDestinationFromValue(effect.value) ?? fallbackRedirectLocation(effect.code);
    if (!redirect) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return redirect;
  }
  return undefined;
}

export function leaveFieldRedirectLocation(
  state: DuelState,
  uid: string,
  destination: DuelLocation,
  createContext: ContinuousEffectContextFactory,
): RedirectDestination | undefined {
  const card = findCard(state, uid);
  if (!card || !isFieldLocation(card.location) || isFieldLocation(destination)) return undefined;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 60) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const redirect = redirectDestinationFromValue(effect.value);
    if (!redirect) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return redirect;
  }
  return undefined;
}

export function findDestroyReplacementEffect(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): ContinuousEffectMatch | undefined {
  return findDestroyReplacementEffects(state, uid, createContext)[0];
}

export function findDestroyReplacementEffects(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): ContinuousEffectMatch[] {
  return findReplacementEffects(state, uid, 45, 50, createContext);
}

export function findReleaseReplacementEffect(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): ContinuousEffectMatch | undefined {
  return findReleaseReplacementEffects(state, uid, createContext)[0];
}

export function findReleaseReplacementEffects(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): ContinuousEffectMatch[] {
  return findReplacementEffects(state, uid, 51, undefined, createContext);
}

export function findSendReplacementEffect(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): ContinuousEffectMatch | undefined {
  return findSendReplacementEffects(state, uid, createContext)[0];
}

export function findSendReplacementEffects(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): ContinuousEffectMatch[] {
  return findReplacementEffects(state, uid, 52, undefined, createContext);
}

function findReplacementEffects(
  state: DuelState,
  uid: string,
  firstCode: number,
  secondCode: number | undefined,
  createContext: ContinuousEffectContextFactory,
): ContinuousEffectMatch[] {
  const card = findCard(state, uid);
  if (!card) return [];
  const matches: ContinuousEffectMatch[] = [];
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || (effect.code !== firstCode && effect.code !== secondCode)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAffectsCard(effect, source, card)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) matches.push({ effect, source, card });
  }
  return matches;
}

export function findIndestructibleEffect(state: DuelState, uid: string, reason: number, createContext: ContinuousEffectContextFactory, reasonPlayer?: PlayerId): ContinuousEffectMatch | undefined {
  const card = findCard(state, uid);
  if (!card) return undefined;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !isIndestructibleCodeForReason(effect.code, reason)) continue;
    if (effect.code === 47 && (effect.value ?? 1) <= 0) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    if (effect.valuePredicate && !effect.valuePredicate(ctx, reasonPlayer)) continue;
    return { effect, source, card };
  }
  return undefined;
}

export function isMoveToLocationPrevented(state: DuelState, uid: string, to: DuelLocation, reason: number, createContext: ContinuousEffectContextFactory): boolean {
  const card = findCard(state, uid);
  if (!card) return false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !isCannotMoveCodeForLocation(effect.code, to, reason)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isMaterialUsePrevented(state: DuelState, uid: string, kind: MaterialUseKind, createContext: ContinuousEffectContextFactory): boolean {
  const card = findCard(state, uid);
  if (!card) return false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !isCannotMaterialCodeForKind(effect.code, kind)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isReleasePrevented(state: DuelState, uid: string, reason: number, createContext: ContinuousEffectContextFactory): boolean {
  const card = findCard(state, uid);
  if (!card) return false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !isUnreleasableCodeForReason(effect.code, reason)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

function redirectDestinationFromValue(value: number | undefined): RedirectDestination | undefined {
  if (value === 0x02) return { location: "hand" };
  if (value === 0x10) return { location: "graveyard" };
  if (value === 0x20) return { location: "banished" };
  if (value === 0x40) return { location: "extraDeck" };
  if (value === 0x01) return { location: "deck" };
  if (value === 0x10001) return { location: "deck", deckSequence: 1 };
  if (value === 0x20001) return { location: "deck", deckSequence: 2 };
  return undefined;
}

function fallbackRedirectLocation(code: number | undefined): RedirectDestination | undefined {
  if (code === 63) return { location: "banished" };
  if (code === 64) return { location: "graveyard" };
  return undefined;
}

function isDestinationRedirectCode(code: number | undefined, destination: DuelLocation): boolean {
  if (code === 61) return destination === "hand";
  if (code === 62) return destination === "deck";
  if (code === 63) return destination === "graveyard";
  if (code === 64) return destination === "banished";
  return false;
}

function isFieldLocation(location: DuelLocation): boolean {
  return location === "monsterZone" || location === "spellTrapZone";
}

function continuousEffectAffectsCard(effect: DuelEffectDefinition, source: DuelCardInstance, card: DuelCardInstance): boolean {
  if (source.uid === card.uid) return true;
  return (effect.targetRange !== undefined || ((effect.property ?? 0) & 0x800) !== 0) && continuousEffectTargetsPlayer(effect, source, card.controller);
}

function continuousEffectAppliesToCard(effect: DuelEffectDefinition, source: DuelCardInstance, card: DuelCardInstance, ctx: DuelEffectContext): boolean {
  if (!continuousEffectAffectsCard(effect, source, card) && !effect.targetCardPredicate) return false;
  return !effect.targetCardPredicate || effect.targetCardPredicate(ctx, card);
}

function continuousEffectTargetsPlayer(effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId): boolean {
  if (effect.targetRange === undefined && ((effect.property ?? 0) & 0x800) === 0) return source.controller === player;
  const [selfTarget = 0, opponentTarget = 0] = effect.targetRange ?? [1, 0];
  if (source.controller === player) return selfTarget !== 0;
  return opponentTarget !== 0;
}

function isIndestructibleCodeForReason(code: number | undefined, reason: number): boolean {
  if (code === 40) return true;
  if (code === 41) return (reason & 0x40) !== 0;
  if (code === 42) return (reason & 0x20) !== 0;
  if (code === 47) return true;
  return false;
}

function isCannotMoveCodeForLocation(code: number | undefined, location: DuelLocation, reason: number): boolean {
  if (code === 57) return (reason & duelReason.cost) !== 0;
  if (code === 59) return location === "graveyard" && (reason & 0x80) !== 0;
  if (code === 65) return location === "hand";
  if (code === 66) return location === "deck" || location === "extraDeck";
  if (code === 67) return location === "banished";
  if (code === 68) return location === "graveyard";
  return false;
}

function isSummonNegationCode(code: number | undefined, summonType: DuelSummonType): boolean {
  if (code === 26) return summonType !== "flip";
  if (code === 27) return summonType !== "normal" && summonType !== "tribute" && summonType !== "flip";
  if (code === 39) return summonType === "flip";
  return false;
}

function isCannotMaterialCodeForKind(code: number | undefined, kind: MaterialUseKind): boolean {
  if (code === 248) return true;
  if (code === 235) return kind === "fusion";
  if (code === 236) return kind === "synchro";
  if (code === 238) return kind === "xyz";
  if (code === 239) return kind === "link";
  return false;
}

function isUnreleasableCodeForReason(code: number | undefined, reason: number): boolean {
  if (code === 46) return true;
  if (code === 43) return (reason & 0x10) !== 0;
  if (code === 44) return (reason & 0x10) === 0;
  if (code === 48) return (reason & 0x40) !== 0;
  return false;
}
