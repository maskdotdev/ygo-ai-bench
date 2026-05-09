import { findCard } from "#duel/card-state.js";
import {
  attackActions,
  canChangeDuelCardPosition as canChangeDuelCardPositionRule,
  canDuelCardAttack as canDuelCardAttackRule,
  changeDuelCardPosition as changeDuelCardPositionRule,
  declareDuelAttack as declareDuelAttackRule,
  getDuelAttackTargets as getDuelAttackTargetsRule,
  negateDuelAttack as negateDuelAttackRule,
  positionChangeActions as positionChangeActionsRule,
  replayAttackActions as replayAttackActionsRule,
  replayDuelAttack as replayDuelAttackRule,
} from "#duel/battle.js";
import { openAttackResponseWindow } from "#duel/attack-response-window.js";
import {
  additionalBattleDamagePlayers,
  attackAllMonsterCount,
  battleDamageReason,
  canDirectAttackThroughTargets,
  extraAttackCount,
  extraMonsterAttackCount,
  firstAttackRequiredUids,
  hasDefenseAttack,
  hasMustAttackMonsterRestriction,
  hasOnlyAttackMonsterRestriction,
  hasPiercingBattleDamage,
  continuousEffectAppliesToCard,
  isAttackPrevented,
  isBattleTargetSelectionPrevented,
  isBattleTargetPrevented,
  isDirectAttackPrevented,
  isEffectPositionChangePrevented,
  isPositionChangePrevented,
  isTurnSetPrevented,
  mustAttackMonsterTargetAllowed,
  mustAttackRequiredUids,
  onlyBeAttackedTargetUids,
  type ContinuousEffectContextFactory,
} from "#duel/continuous-effects.js";
import type { CardPosition, DuelAction, DuelCardInstance, DuelEffectContext, DuelEventName, DuelState, PlayerId } from "#duel/types.js";

export type PositionChangeSource = "effect" | "manual";

export interface CoreBattleHandlers {
  additionalBattleDamagePlayers(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): PlayerId[];
  battleDamagePlayer(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): PlayerId;
  battleDamageReason(state: DuelState, player: PlayerId, battleCards?: DuelCardInstance[]): number;
  changeBattleDamage(state: DuelState, player: PlayerId, amount: number, battleCards?: DuelCardInstance[]): number;
  collectEvent(state: DuelState, eventName: DuelEventName, eventCard?: DuelCardInstance | DuelCardInstance[], payload?: { eventPlayer?: PlayerId; eventValue?: number; eventReason?: number }): void;
  createContinuousContext(state: DuelState): ContinuousEffectContextFactory;
  damagePlayer(state: DuelState, player: PlayerId, amount: number, reason?: number): number;
  destroyCard(state: DuelState, uid: string, controller?: PlayerId, reason?: number, reasonPlayer?: PlayerId): DuelCardInstance;
  getAttackValue(state: DuelState, card: DuelCardInstance): number;
  getDefenseValue(state: DuelState, card: DuelCardInstance): number;
  hasPiercingDamage(state: DuelState, card: DuelCardInstance): boolean;
}

export function appendBattleActions(actions: DuelAction[], state: DuelState, player: PlayerId, handlers: CoreBattleHandlers): void {
  if (state.phase !== "battle") return;
  const createContext = handlers.createContinuousContext(state);
  const onlyTargets = onlyBeAttackedTargetUids(state, player, createContext);
  const firstAttackers = firstAttackRequiredUids(state, player, createContext);
  for (const action of attackActions(
    state,
    player,
    (card) => totalExtraAttackCount(state, card, createContext),
    (card) => canSelectBattleTarget(state, player, card, createContext) && isOnlyAttackTargetAllowed(onlyTargets, card),
    (card) => canDirectAttackThroughTargets(state, card, createContext),
  )) {
    if (action.type !== "declareAttack") continue;
    const attacker = findCard(state, action.attackerUid);
    if (!attacker || isAttackPrevented(state, attacker, createContext)) continue;
    if (!isFirstAttackAllowed(firstAttackers, attacker)) continue;
    if (action.targetUid === undefined && (isDirectAttackPrevented(state, attacker, createContext) || hasMustAttackMonsterRestriction(state, attacker, createContext) || hasOnlyAttackMonsterRestriction(state, attacker, createContext))) continue;
    if (action.targetUid === undefined && hasSpentMonsterOnlyExtraAttack(state, attacker, createContext)) continue;
    const target = action.targetUid === undefined ? undefined : findCard(state, action.targetUid);
    if (target && !canAttackMonsterTarget(state, attacker, target, createContext)) continue;
    actions.push(action);
  }
}

export function canCoreDuelCardAttack(state: DuelState, uid: string, handlers: CoreBattleHandlers, extraAttackAllowance = 0): boolean {
  const card = findCard(state, uid);
  const createContext = handlers.createContinuousContext(state);
  const firstAttackers = firstAttackRequiredUids(state, card?.controller ?? state.turnPlayer, createContext);
  return Boolean(
    card &&
      isFirstAttackAllowed(firstAttackers, card) &&
      !isAttackPrevented(state, card, createContext) &&
      canDuelCardAttackRule(state, uid, totalExtraAttackCount(state, card, createContext) + Math.max(0, extraAttackAllowance)),
  );
}

export function hasCoreMustAttackAction(state: DuelState, player: PlayerId, actions: DuelAction[], handlers: CoreBattleHandlers): boolean {
  if (state.phase !== "battle") return false;
  const createContext = handlers.createContinuousContext(state);
  const mustAttackers = mustAttackRequiredUids(state, player, createContext);
  return actions.some((action) => action.type === "declareAttack" && mustAttackers.has(action.attackerUid));
}

export function getCoreDuelAttackTargets(state: DuelState, attackerUid: string, handlers: CoreBattleHandlers): DuelCardInstance[] {
  const card = findCard(state, attackerUid);
  const createContext = handlers.createContinuousContext(state);
  const onlyTargets = onlyBeAttackedTargetUids(state, card?.controller ?? state.turnPlayer, createContext);
  if (!card || isAttackPrevented(state, card, createContext)) return [];
  return getDuelAttackTargetsRule(
    state,
    attackerUid,
    totalExtraAttackCount(state, card, createContext),
    (target) => canSelectBattleTarget(state, card.controller, target, createContext) && isOnlyAttackTargetAllowed(onlyTargets, target) && canAttackMonsterTarget(state, card, target, createContext),
  );
}

export function declareCoreDuelAttack(state: DuelState, player: PlayerId, attackerUid: string, targetUid: string | undefined, handlers: CoreBattleHandlers): void {
  const attacker = findCard(state, attackerUid);
  const createContext = handlers.createContinuousContext(state);
  const onlyTargets = onlyBeAttackedTargetUids(state, player, createContext);
  if (attacker && isAttackPrevented(state, attacker, createContext)) throw new Error(`${attacker.name} cannot attack`);
  if (attacker && !isFirstAttackAllowed(firstAttackRequiredUids(state, player, createContext), attacker)) throw new Error(`${attacker.name} cannot attack before the first attacker`);
  if (attacker && targetUid === undefined && isDirectAttackPrevented(state, attacker, createContext)) throw new Error(`${attacker.name} cannot attack directly`);
  if (attacker && targetUid === undefined && hasMustAttackMonsterRestriction(state, attacker, createContext)) throw new Error(`${attacker.name} must attack a monster`);
  if (attacker && targetUid === undefined && hasOnlyAttackMonsterRestriction(state, attacker, createContext)) throw new Error(`${attacker.name} can only attack monsters`);
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
    getAttackValue: (card) => handlers.getAttackValue(state, card),
    getDefenseValue: (card) => handlers.getDefenseValue(state, card),
    hasPiercingDamage: (card) => handlers.hasPiercingDamage(state, card),
  }, attacker ? totalExtraAttackCount(state, attacker, createContext) : 0, (target) => !attacker || (canSelectBattleTarget(state, attacker.controller, target, createContext) && isOnlyAttackTargetAllowed(onlyTargets, target) && canAttackMonsterTarget(state, attacker, target, createContext)), attacker ? canDirectAttackThroughTargets(state, attacker, createContext) : false);
  if (state.pendingTriggers.length === pendingTriggerCount) openAttackResponseWindow(state, player);
}

export function replayCoreDuelAttack(state: DuelState, player: PlayerId, attackerUid: string, targetUid: string | undefined, handlers: CoreBattleHandlers): void {
  const attacker = findCard(state, attackerUid);
  const createContext = handlers.createContinuousContext(state);
  const onlyTargets = onlyBeAttackedTargetUids(state, player, createContext);
  replayDuelAttackRule(
    state,
    player,
    attackerUid,
    targetUid,
    (target) => !attacker || (canSelectBattleTarget(state, attacker.controller, target, createContext) && isOnlyAttackTargetAllowed(onlyTargets, target) && canAttackMonsterTarget(state, attacker, target, createContext)),
    (directAttacker, targets) => canReplayDirectAttack(state, directAttacker, targets, createContext),
  );
}

export function coreReplayAttackActions(state: DuelState, player: PlayerId, handlers: CoreBattleHandlers): DuelAction[] {
  const attacker = state.pendingBattle === undefined ? undefined : findCard(state, state.pendingBattle.attackerUid);
  const createContext = handlers.createContinuousContext(state);
  const onlyTargets = onlyBeAttackedTargetUids(state, player, createContext);
  return replayAttackActionsRule(
    state,
    player,
    (target) => !attacker || (canSelectBattleTarget(state, attacker.controller, target, createContext) && isOnlyAttackTargetAllowed(onlyTargets, target) && canAttackMonsterTarget(state, attacker, target, createContext)),
    (directAttacker, targets) => canReplayDirectAttack(state, directAttacker, targets, createContext),
  );
}

export function canCoreAttackTarget(state: DuelState, attacker: DuelCardInstance, target: DuelCardInstance, handlers: CoreBattleHandlers): boolean {
  const createContext = handlers.createContinuousContext(state);
  const onlyTargets = onlyBeAttackedTargetUids(state, attacker.controller, createContext);
  return canSelectBattleTarget(state, attacker.controller, target, createContext) && isOnlyAttackTargetAllowed(onlyTargets, target) && canAttackMonsterTarget(state, attacker, target, createContext);
}

export function negateCoreDuelAttack(state: DuelState): boolean {
  return negateDuelAttackRule(state);
}

export function canCoreChangeDuelCardPosition(state: DuelState, uid: string, position: CardPosition, handlers: CoreBattleHandlers, source: PositionChangeSource = "effect"): boolean {
  const card = findCard(state, uid);
  const createContext = handlers.createContinuousContext(state);
  return Boolean(
    card
      && canChangeDuelCardPositionRule(state, uid, position)
      && !isPositionChangePrevented(state, card, createContext)
      && (source !== "effect" || !isEffectPositionChangePrevented(state, card, createContext))
      && (position !== "faceDownDefense" || !isTurnSetPrevented(state, card, createContext)),
  );
}

export function changeCoreDuelCardPosition(state: DuelState, player: PlayerId, uid: string, position: CardPosition, handlers: CoreBattleHandlers, source: PositionChangeSource = "effect"): DuelCardInstance {
  if (!canCoreChangeDuelCardPosition(state, uid, position, handlers, source)) {
    const card = findCard(state, uid);
    throw new Error(`${card?.name ?? uid} cannot change position`);
  }
  return changeDuelCardPositionRule(state, player, uid, position, (eventName, eventCard) => handlers.collectEvent(state, eventName, eventCard));
}

export function corePositionChangeActions(state: DuelState, player: PlayerId, handlers: CoreBattleHandlers): DuelAction[] {
  const createContext = handlers.createContinuousContext(state);
  return positionChangeActionsRule(state, player, (card) => !isPositionChangePrevented(state, card, createContext));
}

function canSelectBattleTarget(state: DuelState, player: PlayerId, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  return !isBattleTargetPrevented(state, card, createContext) && !isBattleTargetSelectionPrevented(state, player, card, createContext);
}

function canAttackMonsterTarget(state: DuelState, attacker: DuelCardInstance, target: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  return mustAttackMonsterTargetAllowed(state, attacker, target, createContext);
}

function isOnlyAttackTargetAllowed(onlyTargets: Set<string>, target: DuelCardInstance): boolean {
  return onlyTargets.size === 0 || onlyTargets.has(target.uid);
}

function isFirstAttackAllowed(firstAttackers: Set<string>, attacker: DuelCardInstance): boolean {
  return firstAttackers.size === 0 || firstAttackers.has(attacker.uid);
}

function totalExtraAttackCount(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): number {
  return extraAttackCount(state, card, createContext) + extraMonsterAttackCount(state, card, createContext) + Math.max(0, attackAllMonsterCount(state, card, createContext) - 1);
}

function hasSpentMonsterOnlyExtraAttack(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  return (attackAllMonsterCount(state, card, createContext) > 0 || extraMonsterAttackCount(state, card, createContext) > 0) && state.attacksDeclared.includes(card.uid);
}

function canReplayDirectAttack(state: DuelState, attacker: DuelCardInstance, targets: DuelCardInstance[], createContext: ContinuousEffectContextFactory): boolean {
  return !isDirectAttackPrevented(state, attacker, createContext)
    && !hasMustAttackMonsterRestriction(state, attacker, createContext)
    && !hasOnlyAttackMonsterRestriction(state, attacker, createContext)
    && (targets.length === 0 || canDirectAttackThroughTargets(state, attacker, createContext));
}

export function hasCorePiercingBattleDamage(state: DuelState, card: DuelCardInstance, handlers: CoreBattleHandlers): boolean {
  return hasPiercingBattleDamage(state, card, handlers.createContinuousContext(state));
}

export function getCoreBattleAttackValue(state: DuelState, card: DuelCardInstance, handlers: CoreBattleHandlers): number {
  const createContext = handlers.createContinuousContext(state);
  if (hasDefenseAttack(state, card, createContext)) return getCoreBattleDefenseValue(state, card, handlers);
  const baseAttack = continuousSetBaseStatValue(state, card, 103, card.data.attack ?? 0, createContext);
  const updatedAttack = baseAttack + (card.attackModifier ?? 0) + continuousStatUpdateValue(state, card, 100, createContext);
  const setAttack = continuousSetStatValue(state, card, 101, createContext) ?? updatedAttack;
  return Math.max(0, continuousSetStatValue(state, card, 102, createContext) ?? setAttack);
}

export function getCoreBattleDefenseValue(state: DuelState, card: DuelCardInstance, handlers: CoreBattleHandlers): number {
  const createContext = handlers.createContinuousContext(state);
  const baseDefense = continuousSetBaseStatValue(state, card, 107, card.data.defense ?? 0, createContext);
  const updatedDefense = baseDefense + (card.defenseModifier ?? 0) + continuousStatUpdateValue(state, card, 104, createContext);
  const setDefense = continuousSetStatValue(state, card, 105, createContext) ?? updatedDefense;
  return Math.max(0, continuousSetStatValue(state, card, 106, createContext) ?? setDefense);
}

export function getCoreAdditionalBattleDamagePlayers(state: DuelState, player: PlayerId, battleCards: DuelCardInstance[] | undefined, handlers: CoreBattleHandlers): PlayerId[] {
  return additionalBattleDamagePlayers(state, player, battleCards ?? [], handlers.createContinuousContext(state));
}

export function getCoreBattleDamageReason(state: DuelState, player: PlayerId, battleCards: DuelCardInstance[] | undefined, handlers: CoreBattleHandlers): number {
  return battleDamageReason(state, player, battleCards ?? [], handlers.createContinuousContext(state));
}

function continuousStatUpdateValue(state: DuelState, card: DuelCardInstance, code: number, createContext: ContinuousEffectContextFactory): number {
  return matchingContinuousStatEffects(state, card, code, createContext)
    .reduce((total, { effect, ctx }) => total + (continuousStatEffectValue(effect, card, ctx) ?? 0), 0);
}

function continuousSetBaseStatValue(state: DuelState, card: DuelCardInstance, code: number, fallback: number, createContext: ContinuousEffectContextFactory): number {
  return continuousSetStatValue(state, card, code, createContext) ?? fallback;
}

function continuousSetStatValue(state: DuelState, card: DuelCardInstance, code: number, createContext: ContinuousEffectContextFactory): number | undefined {
  const match = matchingContinuousStatEffects(state, card, code, createContext)
    .filter(({ effect }) => effect.value !== undefined || effect.statValue !== undefined)
    .at(-1);
  return match ? continuousStatEffectValue(match.effect, card, match.ctx) : undefined;
}

function matchingContinuousStatEffects(
  state: DuelState,
  card: DuelCardInstance,
  code: number,
  createContext: ContinuousEffectContextFactory,
): Array<{ effect: DuelState["effects"][number]; ctx: DuelEffectContext }> {
  const matches: Array<{ effect: DuelState["effects"][number]; ctx: DuelEffectContext }> = [];
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== code) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = createContext(effect, source, card);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    matches.push({ effect, ctx });
  }
  return matches;
}

function continuousStatEffectValue(effect: DuelState["effects"][number], card: DuelCardInstance, ctx: DuelEffectContext): number | undefined {
  return effect.statValue?.(ctx, card) ?? effect.value;
}
