import { findCard, getCards, pushDuelLog, recordPreviousDuelCardState, requireControlledCard } from "#duel/card-state.js";
import { duelActivity, recordAttackActivity } from "#duel/activity.js";
import { clearBattleWindowState, currentBattleWindowKind, markBattleWindowAttackNegated, openBattleWindowState } from "#duel/battle-window-state.js";
import { pruneResetEffectsAfterPositionChange } from "#duel/effect-reset.js";
import { pruneDuelFlagEffectsAfterPositionChange } from "#duel/flags.js";
import { otherPlayer } from "#duel/player-id.js";
import { duelReason } from "#duel/reasons.js";
import { cardTypeFlags } from "#duel/card-stats.js";
import { isDuelPhaseSkipped } from "#duel/turn-flow.js";
import type { DuelEventPayload } from "#duel/event-history.js";
import type { CardPosition, DuelAction, DuelCardInstance, DuelEventName, DuelState, PlayerId } from "#duel/types.js";

export interface DuelBattleCallbacks {
  canAttackTarget?(attacker: DuelCardInstance, target: DuelCardInstance): boolean;
  applyStoredBattleDamage?(battleCards?: DuelCardInstance[]): boolean;
  changeBattleDamage?(player: PlayerId, amount: number, battleCards?: DuelCardInstance[]): number;
  collectEvent(eventName: DuelEventName, eventCard?: DuelCardInstance | DuelCardInstance[], payload?: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId">): void;
  damagePlayer(player: PlayerId, amount: number, battleCards?: DuelCardInstance[]): number;
  destroyCard(uid: string, controller?: PlayerId, reason?: number, reasonPlayer?: PlayerId): DuelCardInstance;
  preventDestroyCard?(uid: string, controller: PlayerId | undefined, reason: number, reasonPlayer: PlayerId | undefined, payload?: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId">): DuelCardInstance | undefined;
  getAttackValue?(card: DuelCardInstance): number;
  getDefenseValue?(card: DuelCardInstance): number;
  hasPiercingDamage?(card: DuelCardInstance): boolean;
}

export interface ResolvePendingDuelBattleOptions {
  preserveBattleContext?: boolean;
}

export type DuelAttackTargetPredicate = (target: DuelCardInstance, attacker: DuelCardInstance) => boolean;
export type DuelDirectAttackPredicate = (attacker: DuelCardInstance, targets: DuelCardInstance[]) => boolean;

export interface DeclareDuelAttackOptions {
  preserveAttackCostPaid?: boolean;
}

export function canDuelCardAttack(state: DuelState, uid: string, extraAttacks = 0): boolean {
  const card = findCard(state, uid);
  return Boolean(card && canAttackWithCard(state, card, extraAttacks));
}

export function getDuelAttackTargets(state: DuelState, attackerUid: string, extraAttacks = 0, canAttackTarget: DuelAttackTargetPredicate = () => true): DuelCardInstance[] {
  const attacker = findCard(state, attackerUid);
  if (!attacker || !canAttackWithCard(state, attacker, extraAttacks)) return [];
  return getAttackTargets(state, attacker.controller, attacker, canAttackTarget);
}

export function declareDuelAttack(
  state: DuelState,
  player: PlayerId,
  attackerUid: string,
  targetUid: string | undefined,
  callbacks: DuelBattleCallbacks,
  extraAttacks = 0,
  canAttackTarget: DuelAttackTargetPredicate = () => true,
  canDirectAttackThroughTargets = false,
  options: DeclareDuelAttackOptions = {},
): void {
  const attacker = requireControlledCard(state, player, attackerUid, "monsterZone");
  if (state.phase !== "battle") throw new Error("Attacks can only be declared during the battle phase");
  if (!canAttackWithCard(state, attacker, extraAttacks)) throw new Error(`${attacker.name} cannot attack`);

  const targets = getAttackTargets(state, player, attacker, canAttackTarget);
  const target = targetUid === undefined ? undefined : findCard(state, targetUid);
  if (targets.length > 0) {
    if (targetUid === undefined && canDirectAttackThroughTargets) {
      // Direct-attack effects permit a direct declaration even while attack targets exist.
    } else if (!target || !targets.some((candidate) => candidate.uid === target.uid)) {
      throw new Error("Attack target is not legal");
    }
  } else if (targetUid !== undefined) {
    throw new Error("Direct attacks cannot have a target");
  }

  state.attacksDeclared.push(attacker.uid);
  if (!options.preserveAttackCostPaid) state.attackCostPaid = 0;
  recordAttackActivity(state, player, attacker);
  state.currentAttack = createBattleAttackState(attacker.uid, target?.uid, targets);
  state.pendingBattle = { ...state.currentAttack };
  if (target) recordBattledPair(state, attacker.uid, target.uid);
  openBattleWindowState(state, target ? "attackTargetConfirmation" : "attackDeclaration", "attack", player);
  if (!target) {
    pushDuelLog(state, "attack", player, attacker.name, "Direct attack");
    callbacks.collectEvent("attackDeclared", attacker);
    return;
  }

  pushDuelLog(state, "attack", player, attacker.name, `Attacked ${target.name}`);
  callbacks.collectEvent("attackDeclared", [attacker, target]);
  callbacks.collectEvent("battleTargeted", target);
}

export function negateDuelAttack(state: DuelState): boolean {
  const attack = state.currentAttack ?? state.pendingBattle;
  if (!attack) return false;
  const attacker = findCard(state, attack.attackerUid);
  if (attacker && !state.attackCanceledUids.includes(attacker.uid)) state.attackCanceledUids.push(attacker.uid);
  markBattleWindowAttackNegated(state);
  delete state.currentAttack;
  delete state.pendingBattle;
  state.attackPasses = [];
  state.damagePasses = [];
  state.attackCostPaid = 0;
  clearBattleWindowState(state);
  state.waitingFor = attacker?.controller ?? state.turnPlayer;
  pushDuelLog(state, "attack", attacker?.controller ?? state.turnPlayer, attacker?.name, "Negated attack");
  return true;
}

export function resolvePendingDuelBattle(state: DuelState, callbacks: DuelBattleCallbacks, options: ResolvePendingDuelBattleOptions = {}): boolean {
  const pending = state.pendingBattle;
  if (!pending) return false;
  if (pending.resultApplied) {
    const appliedStoredDamage = callbacks.applyStoredBattleDamage?.(pendingBattleCards(state, pending)) ?? false;
    const resolvedDeferredDestruction = resolveDeferredBattleDestroyed(state, pending, callbacks);
    clearPendingBattleState(state);
    return appliedStoredDamage || resolvedDeferredDestruction;
  }
  const attacker = findCard(state, pending.attackerUid);
  if (!attacker || attacker.location !== "monsterZone") {
    clearPendingBattleState(state);
    return false;
  }
  const target = pending.targetUid === undefined ? undefined : findCard(state, pending.targetUid);
  if (pending.targetUid !== undefined && (!target || target.location !== "monsterZone")) {
    if (options.preserveBattleContext) return false;
    if (!canResolveAsBattleReplay(state, pending)) {
      clearPendingBattleState(state);
      return false;
    }
    openReplayDecisionWindow(state, attacker);
    return false;
  }
  const currentTargets = getAttackTargets(state, attacker.controller, attacker, (target) => callbacks.canAttackTarget?.(attacker, target) ?? true);
  if (canResolveAsBattleReplay(state, pending) && didReplayTargetsChange(pending, currentTargets)) {
    if (options.preserveBattleContext) return false;
    openReplayDecisionWindow(state, attacker);
    return false;
  }
  if (options.preserveBattleContext) {
    if (!target) {
      const damagedPlayer = otherPlayer(attacker.controller);
      callbacks.damagePlayer(damagedPlayer, getBattleAttack(attacker, callbacks), [attacker]);
      pending.damageApplied = true;
      markBattleResultApplied(state, options);
      return true;
    }
    const resolved = resolveWithPreservedBattleContext(state, pending, attacker, target, callbacks, options);
    if (resolved !== undefined) return resolved;
    return false;
  }
  try {
    if (!target) {
      callbacks.damagePlayer(otherPlayer(attacker.controller), getBattleAttack(attacker, callbacks), [attacker]);
      markBattleResultApplied(state, options);
      return true;
    }
    if (target.location === "monsterZone") resolveBattle(state, attacker, target, callbacks);
    markBattleResultApplied(state, options);
    return true;
  } finally {
    if (!shouldPreserveBattleContext(state, options)) clearPendingBattleState(state);
  }
}

export function markDuelBattleReplayPendingIfNeeded(
  state: DuelState,
  canAttackTarget: (attacker: DuelCardInstance, target: DuelCardInstance) => boolean = () => true,
): boolean {
  const pending = state.pendingBattle;
  if (!pending) return false;
  const attacker = findCard(state, pending.attackerUid);
  if (!attacker || attacker.location !== "monsterZone") return false;
  const target = pending.targetUid === undefined ? undefined : findCard(state, pending.targetUid);
  if (pending.targetUid !== undefined && (!target || target.location !== "monsterZone")) {
    pending.replayPending = true;
    return true;
  }
  const currentTargets = getAttackTargets(state, attacker.controller, attacker, (target) => canAttackTarget(attacker, target));
  if (!didReplayTargetsChange(pending, currentTargets)) return false;
  pending.replayPending = true;
  return true;
}

export function replayAttackActions(
  state: DuelState,
  player: PlayerId,
  canAttackTarget: DuelAttackTargetPredicate = () => true,
  canDirectAttack: DuelDirectAttackPredicate = () => true,
): DuelAction[] {
  if (currentBattleWindowKind(state) !== "replayDecision" || !state.pendingBattle) return [];
  const attacker = findCard(state, state.pendingBattle.attackerUid);
  if (!attacker || attacker.controller !== player || attacker.location !== "monsterZone") return [];
  const targets = getAttackTargets(state, player, attacker, canAttackTarget);
  return [
    { type: "cancelAttack", player, attackerUid: attacker.uid, label: `Cancel ${attacker.name}'s attack` },
    ...(canDirectAttack(attacker, targets) ? [{ type: "replayAttack" as const, player, attackerUid: attacker.uid, directAttack: true as const, label: `${attacker.name}: Attack directly` }] : []),
    ...targets.map((target) => ({ type: "replayAttack" as const, player, attackerUid: attacker.uid, targetUid: target.uid, label: `${attacker.name}: Attack ${target.name}` })),
  ];
}

export function replayDuelAttack(
  state: DuelState,
  player: PlayerId,
  attackerUid: string,
  targetUid?: string,
  canAttackTarget: DuelAttackTargetPredicate = () => true,
  canDirectAttack: DuelDirectAttackPredicate = () => true,
): void {
  const attacker = requireControlledCard(state, player, attackerUid, "monsterZone");
  if (currentBattleWindowKind(state) !== "replayDecision" || state.pendingBattle?.attackerUid !== attacker.uid) throw new Error("No replay decision is pending for this attacker");
  const targets = getAttackTargets(state, player, attacker, canAttackTarget);
  const target = targetUid === undefined ? undefined : findCard(state, targetUid);
  if (targets.length > 0) {
    if (targetUid === undefined) {
      if (!canDirectAttack(attacker, targets)) throw new Error(`${attacker.name} cannot replay as a direct attack`);
    } else if (!target || !targets.some((candidate) => candidate.uid === target.uid)) {
      throw new Error("Replay attack target is not legal");
    }
  } else if (targetUid !== undefined) {
    throw new Error("Replay direct attacks cannot have a target");
  } else if (!canDirectAttack(attacker, targets)) {
    throw new Error(`${attacker.name} cannot replay as a direct attack`);
  }
  state.currentAttack = createBattleAttackState(attacker.uid, target?.uid, targets);
  state.pendingBattle = { ...state.currentAttack };
  if (target) recordBattledPair(state, attacker.uid, target.uid);
  pushDuelLog(state, "attackReplay", player, attacker.name, target ? `Replayed attack on ${target.name}` : "Replayed direct attack");
  openBattleWindowState(state, "attackNegationResponse", "attack", otherPlayer(player));
  state.waitingFor = otherPlayer(player);
}

export function cancelReplayAttack(state: DuelState, player: PlayerId, attackerUid: string): void {
  const attacker = requireControlledCard(state, player, attackerUid, "monsterZone");
  if (currentBattleWindowKind(state) !== "replayDecision" || state.pendingBattle?.attackerUid !== attacker.uid) throw new Error("No replay decision is pending for this attacker");
  delete state.pendingBattle;
  delete state.currentAttack;
  state.attackPasses = [];
  state.damagePasses = [];
  state.attackCostPaid = 0;
  clearBattleWindowState(state);
  state.waitingFor = state.turnPlayer;
  pushDuelLog(state, "attackReplay", player, attacker.name, "Canceled replay attack");
}

export function canChangeDuelCardPosition(state: DuelState, uid: string, position: CardPosition): boolean {
  if (!canEffectChangeDuelCardPosition(state, uid, position)) return false;
  const card = findCard(state, uid);
  if (!card) return false;
  if (state.positionsChanged.includes(card.uid)) return false;
  if (state.attacksDeclared.includes(card.uid)) return false;
  if (wasSummonedOrSetThisTurn(state, card)) return false;
  return true;
}

export function canEffectChangeDuelCardPosition(state: DuelState, uid: string, position: CardPosition): boolean {
  const card = findCard(state, uid);
  if (!card || card.location !== "monsterZone") return false;
  if (!isMonsterLike(state, card)) return false;
  if ((cardTypeFlags(card, state) & 0x4000000) !== 0) return false;
  if (!isMonsterPosition(position)) return false;
  if (card.position === position) return false;
  return true;
}

export function setDuelAttackCostPaid(state: DuelState, status: number): number {
  state.attackCostPaid = Math.max(0, Math.min(2, Math.trunc(status)));
  return state.attackCostPaid;
}

export function getDuelAttackCostPaid(state: DuelState): number {
  return state.attackCostPaid;
}

export function changeDuelCardPosition(state: DuelState, player: PlayerId, uid: string, position: CardPosition, collectEvent: DuelBattleCallbacks["collectEvent"], payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): DuelCardInstance {
  const card = requireControlledCard(state, player, uid, "monsterZone");
  if (!canChangeDuelCardPosition(state, uid, position)) throw new Error(`${card.name} cannot change to ${position}`);
  return applyDuelCardPositionChange(state, player, uid, position, collectEvent, payload);
}

export function changeDuelCardPositionByEffect(state: DuelState, player: PlayerId, uid: string, position: CardPosition, collectEvent: DuelBattleCallbacks["collectEvent"], payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): DuelCardInstance {
  const card = requireControlledCard(state, player, uid, "monsterZone");
  if (!canEffectChangeDuelCardPosition(state, uid, position)) throw new Error(`${card.name} cannot change to ${position}`);
  return applyDuelCardPositionChange(state, player, uid, position, collectEvent, payload);
}

function applyDuelCardPositionChange(state: DuelState, player: PlayerId, uid: string, position: CardPosition, collectEvent: DuelBattleCallbacks["collectEvent"], payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): DuelCardInstance {
  const card = requireControlledCard(state, player, uid, "monsterZone");
  recordPreviousDuelCardState(state, card);
  card.position = position;
  card.faceUp = position !== "faceDownDefense";
  if (payload.eventReasonCardUid !== undefined) card.reasonCardUid = payload.eventReasonCardUid;
  if (payload.eventReasonEffectId !== undefined) card.reasonEffectId = payload.eventReasonEffectId;
  state.positionsChanged.push(card.uid);
  pruneResetEffectsAfterPositionChange(state, card);
  pruneDuelFlagEffectsAfterPositionChange(state, card);
  pushDuelLog(state, "changePosition", player, card.name, position);
  collectEvent("positionChanged", card, payload);
  return card;
}

export function positionChangeActions(
  state: DuelState,
  player: PlayerId,
  canChangePosition: (card: DuelCardInstance, position: CardPosition) => boolean = () => true,
): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const card of getCards(state, player, "monsterZone")) {
    for (const position of nextManualPositions(card)) {
      if (canChangeDuelCardPosition(state, card.uid, position) && canChangePosition(card, position)) {
        actions.push({ type: "changePosition", player, uid: card.uid, position, label: `${card.name}: Change to ${positionLabel(position)}` });
      }
    }
  }
  return actions;
}

export function attackActions(
  state: DuelState,
  player: PlayerId,
  extraAttacksForCard: (card: DuelCardInstance) => number = () => 0,
  canAttackTarget: DuelAttackTargetPredicate = () => true,
  canDirectAttackThroughTargets: (card: DuelCardInstance) => boolean = () => false,
): DuelAction[] {
  const actions: DuelAction[] = [];
  const attackers = getCards(state, player, "monsterZone").filter((card) => canAttackWithCard(state, card, extraAttacksForCard(card)));
  for (const attacker of attackers) {
    const targets = getAttackTargets(state, player, attacker, canAttackTarget);
    if (targets.length === 0) {
      actions.push({ type: "declareAttack", player, attackerUid: attacker.uid, directAttack: true, label: `${attacker.name}: Direct attack` });
      continue;
    }
    for (const target of targets) {
      actions.push({ type: "declareAttack", player, attackerUid: attacker.uid, targetUid: target.uid, label: `${attacker.name}: Attack ${target.name}` });
    }
    if (canDirectAttackThroughTargets(attacker)) {
      actions.push({ type: "declareAttack", player, attackerUid: attacker.uid, directAttack: true, label: `${attacker.name}: Direct attack` });
    }
  }
  return actions;
}

function nextManualPositions(card: DuelCardInstance): CardPosition[] {
  if (card.position === "faceUpAttack") return ["faceUpDefense"];
  if (card.position === "faceUpDefense") return ["faceUpAttack"];
  return [];
}

function wasSummonedOrSetThisTurn(state: DuelState, card: DuelCardInstance): boolean {
  return state.activityHistory.some(
    (record) =>
      record.player === card.controller &&
      record.cardUid === card.uid &&
      (record.activity === duelActivity.summon || record.activity === duelActivity.normalSummon),
  );
}

function positionLabel(position: CardPosition): string {
  if (position === "faceUpAttack") return "Attack";
  if (position === "faceUpDefense") return "Defense";
  if (position === "faceDownDefense") return "face-down Defense";
  return position;
}

export function recordAttackedTarget(state: DuelState, targetUid: string): void {
  if (!state.attackedTargetUids.includes(targetUid)) state.attackedTargetUids.push(targetUid);
}

export function recordBattledPair(state: DuelState, attackerUid: string, targetUid: string): void {
  recordAttackedTarget(state, targetUid);
  if (!state.battlePairs.some((pair) => pair.attackerUid === attackerUid && pair.targetUid === targetUid)) state.battlePairs.push({ attackerUid, targetUid });
}

function canAttackWithCard(state: DuelState, card: DuelCardInstance, extraAttacks: number): boolean {
  if (state.phase !== "battle") return false;
  if (isDuelPhaseSkipped(state, card.controller, "battle")) return false;
  if (card.location !== "monsterZone" || card.controller !== state.turnPlayer) return false;
  if (!isMonsterLike(state, card) || !card.faceUp) return false;
  if (card.position !== "faceUpAttack") return false;
  return state.attacksDeclared.filter((uid) => uid === card.uid).length <= Math.max(0, extraAttacks);
}

function getAttackTargets(state: DuelState, player: PlayerId, attacker: DuelCardInstance, canAttackTarget: DuelAttackTargetPredicate = () => true): DuelCardInstance[] {
  return getCards(state, otherPlayer(player), "monsterZone").filter((card) => canBeBattleTarget(state, card) && canAttackTarget(card, attacker));
}

function resolveBattle(state: DuelState, attacker: DuelCardInstance, target: DuelCardInstance, callbacks: DuelBattleCallbacks): void {
  attacker.battlePosition = attacker.position;
  target.battlePosition = target.position;
  const attackerAttack = getBattleAttack(attacker, callbacks);
  const targetStat = target.position === "faceUpAttack" ? getBattleAttack(target, callbacks) : getBattleDefense(target, callbacks);
  if (target.position === "faceUpAttack") {
    resolveAttackPositionBattle(state, attacker, attackerAttack, target, targetStat, callbacks);
    return;
  }
  resolveDefensePositionBattle(state, attacker, attackerAttack, target, targetStat, callbacks);
}

function resolveAttackPositionBattle(state: DuelState, attacker: DuelCardInstance, attackerAttack: number, target: DuelCardInstance, targetAttack: number, callbacks: DuelBattleCallbacks): void {
  if (attackerAttack > targetAttack) {
    callbacks.damagePlayer(target.controller, attackerAttack - targetAttack, [attacker, target]);
    if (destroyBattleCard(target, attacker.controller, attacker.uid, callbacks)) callbacks.collectEvent("battleDestroyed", target);
    return;
  }
  if (attackerAttack < targetAttack) {
    callbacks.damagePlayer(attacker.controller, targetAttack - attackerAttack, [attacker, target]);
    if (destroyBattleCard(attacker, target.controller, target.uid, callbacks)) callbacks.collectEvent("battleDestroyed", attacker);
    return;
  }
  const destroyedCards: DuelCardInstance[] = [];
  if (destroyBattleCard(attacker, target.controller, target.uid, callbacks)) destroyedCards.push(attacker);
  if (destroyBattleCard(target, attacker.controller, attacker.uid, callbacks)) destroyedCards.push(target);
  if (destroyedCards.length > 0) callbacks.collectEvent("battleDestroyed", destroyedCards);
}

function resolveDefensePositionBattle(state: DuelState, attacker: DuelCardInstance, attackerAttack: number, target: DuelCardInstance, targetDefense: number, callbacks: DuelBattleCallbacks): void {
  if (attackerAttack > targetDefense) {
    if (destroyBattleCard(target, attacker.controller, attacker.uid, callbacks)) callbacks.collectEvent("battleDestroyed", target);
    if (callbacks.hasPiercingDamage?.(attacker)) callbacks.damagePlayer(target.controller, attackerAttack - targetDefense, [attacker, target]);
    return;
  }
  if (attackerAttack < targetDefense) callbacks.damagePlayer(attacker.controller, targetDefense - attackerAttack, [attacker, target]);
}

function destroyBattleCard(card: DuelCardInstance, reasonPlayer: PlayerId, reasonCardUid: string, callbacks: DuelBattleCallbacks): boolean {
  const previousLocation = card.location;
  const previousReasonCardUid = card.reasonCardUid;
  card.reasonCardUid = reasonCardUid;
  const result = callbacks.destroyCard(card.uid, card.controller, duelReason.battle | duelReason.destroy, reasonPlayer);
  const moved = result.uid === card.uid && result.location !== previousLocation;
  if (!moved) {
    if (previousReasonCardUid === undefined) delete card.reasonCardUid;
    else card.reasonCardUid = previousReasonCardUid;
  }
  return moved;
}

function resolveWithPreservedBattleContext(
  state: DuelState,
  pending: NonNullable<DuelState["pendingBattle"]>,
  attacker: DuelCardInstance,
  target: DuelCardInstance | undefined,
  callbacks: DuelBattleCallbacks,
  options: ResolvePendingDuelBattleOptions,
): boolean | undefined {
  if (!target || target.location !== "monsterZone") return undefined;
  attacker.battlePosition = attacker.position;
  target.battlePosition = target.position;
  const attackerAttack = getBattleAttack(attacker, callbacks);
  if (target.position === "faceUpAttack") {
    const targetAttack = getBattleAttack(target, callbacks);
    if (attackerAttack > targetAttack) {
      changePreservedBattleDamage(callbacks, target.controller, attackerAttack - targetAttack, [attacker, target]);
      pending.damageApplied = true;
      deferPreventableBattleDestroyed(pending, target, attacker.controller, attacker.uid, callbacks);
    } else if (attackerAttack < targetAttack) {
      changePreservedBattleDamage(callbacks, attacker.controller, targetAttack - attackerAttack, [attacker, target]);
      pending.damageApplied = true;
      deferPreventableBattleDestroyed(pending, attacker, target.controller, target.uid, callbacks);
    } else {
      deferPreventableBattleDestroyed(pending, attacker, target.controller, target.uid, callbacks);
      deferPreventableBattleDestroyed(pending, target, attacker.controller, attacker.uid, callbacks);
    }
    markBattleResultApplied(state, options);
    return true;
  }
  const targetDefense = getBattleDefense(target, callbacks);
  if (attackerAttack > targetDefense) {
    if (callbacks.hasPiercingDamage?.(attacker)) return undefined;
    deferPreventableBattleDestroyed(pending, target, attacker.controller, attacker.uid, callbacks);
    markBattleResultApplied(state, options);
    return true;
  }
  if (attackerAttack < targetDefense) {
    changePreservedBattleDamage(callbacks, attacker.controller, targetDefense - attackerAttack, [attacker, target]);
    pending.damageApplied = true;
  }
  markBattleResultApplied(state, options);
  return true;
}

function changePreservedBattleDamage(callbacks: DuelBattleCallbacks, player: PlayerId, amount: number, battleCards: DuelCardInstance[]): number {
  return callbacks.changeBattleDamage?.(player, amount, battleCards) ?? callbacks.damagePlayer(player, amount, battleCards);
}

function pendingBattleCards(state: DuelState, pending: NonNullable<DuelState["pendingBattle"]>): DuelCardInstance[] {
  const attacker = findCard(state, pending.attackerUid);
  const target = pending.targetUid === undefined ? undefined : findCard(state, pending.targetUid);
  return [attacker, target].filter((card): card is DuelCardInstance => card !== undefined);
}

function deferBattleDestroyed(pending: NonNullable<DuelState["pendingBattle"]>, uid: string, reasonPlayer: PlayerId, reasonCardUid: string): void {
  const deferred = pending.deferredBattleDestroyed?.filter((record) => record.uid !== uid) ?? [];
  deferred.push({ uid, reasonPlayer, reasonCardUid });
  pending.deferredBattleDestroyed = deferred;
}

function deferPreventableBattleDestroyed(
  pending: NonNullable<DuelState["pendingBattle"]>,
  card: DuelCardInstance,
  reasonPlayer: PlayerId,
  reasonCardUid: string,
  callbacks: DuelBattleCallbacks,
): void {
  const previousReasonCardUid = card.reasonCardUid;
  card.reasonCardUid = reasonCardUid;
  const prevented = callbacks.preventDestroyCard?.(card.uid, card.controller, duelReason.battle | duelReason.destroy, reasonPlayer, { eventReasonCardUid: reasonCardUid });
  if (previousReasonCardUid === undefined) delete card.reasonCardUid;
  else card.reasonCardUid = previousReasonCardUid;
  if (prevented) return;
  deferBattleDestroyed(pending, card.uid, reasonPlayer, reasonCardUid);
}

function resolveDeferredBattleDestroyed(
  state: DuelState,
  pending: NonNullable<DuelState["pendingBattle"]>,
  callbacks: DuelBattleCallbacks,
): boolean {
  let moved = false;
  const destroyedCards: DuelCardInstance[] = [];
  for (const destruction of pending.deferredBattleDestroyed ?? []) {
    const card = findCard(state, destruction.uid);
    if (!card || card.location !== "monsterZone") continue;
    if (!destroyBattleCard(card, destruction.reasonPlayer, destruction.reasonCardUid, callbacks)) continue;
    destroyedCards.push(card);
    moved = true;
  }
  if (destroyedCards.length > 0) callbacks.collectEvent("battleDestroyed", destroyedCards);
  return moved;
}

export function isDuelCardPendingBattleDestroyed(state: DuelState, uid: string): boolean {
  return Boolean(state.pendingBattle?.deferredBattleDestroyed?.some((record) => record.uid === uid));
}

function getBattleAttack(card: DuelCardInstance, callbacks?: DuelBattleCallbacks): number {
  return Math.max(0, callbacks?.getAttackValue?.(card) ?? card.data.attack ?? 0);
}

function getBattleDefense(card: DuelCardInstance, callbacks?: DuelBattleCallbacks): number {
  return Math.max(0, callbacks?.getDefenseValue?.(card) ?? card.data.defense ?? 0);
}

function isMonsterLike(state: DuelState, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, state) & 0x1) !== 0;
}

function canBeBattleTarget(state: DuelState, card: DuelCardInstance): boolean {
  return isMonsterLike(state, card) || (card.location === "monsterZone" && !card.faceUp);
}

function isMonsterPosition(position: CardPosition): boolean {
  return position === "faceUpAttack" || position === "faceUpDefense" || position === "faceDownDefense";
}

function openReplayDecisionWindow(state: DuelState, attacker: DuelCardInstance): void {
  state.attackPasses = [];
  state.damagePasses = [];
  openBattleWindowState(state, "replayDecision", "attack", attacker.controller);
  state.waitingFor = attacker.controller;
  pushDuelLog(state, "attackReplay", attacker.controller, attacker.name, "Replay decision pending");
}

function markBattleResultApplied(state: DuelState, options: ResolvePendingDuelBattleOptions): void {
  if (shouldPreserveBattleContext(state, options) && state.pendingBattle) state.pendingBattle.resultApplied = true;
}

function shouldPreserveBattleContext(state: DuelState, options: ResolvePendingDuelBattleOptions): boolean {
  return options.preserveBattleContext === true && (state as { status?: string }).status !== "ended";
}

function clearPendingBattleState(state: DuelState): void {
  delete state.pendingBattle;
  delete state.currentAttack;
  state.attackPasses = [];
  state.damagePasses = [];
  state.attackCostPaid = 0;
  clearBattleWindowState(state);
}

function createBattleAttackState(attackerUid: string, targetUid: string | undefined, targets: DuelCardInstance[]): NonNullable<DuelState["currentAttack"]> {
  return {
    attackerUid,
    ...(targetUid === undefined ? {} : { targetUid }),
    replayTargetCount: targets.length,
    replayTargetUids: replayTargetUids(targets),
  };
}

function didReplayTargetsChange(pending: NonNullable<DuelState["pendingBattle"]>, currentTargets: DuelCardInstance[]): boolean {
  if (pending.replayTargetCount !== undefined && pending.replayTargetCount !== currentTargets.length) return true;
  return pending.replayTargetUids !== undefined && !sameReplayTargets(pending.replayTargetUids, replayTargetUids(currentTargets));
}

function canOpenBattleReplay(state: DuelState): boolean {
  return currentBattleWindowKind(state) === "attackNegationResponse";
}

function canResolveAsBattleReplay(state: DuelState, pending: NonNullable<DuelState["pendingBattle"]>): boolean {
  return pending.replayPending === true || canOpenBattleReplay(state);
}

function replayTargetUids(targets: DuelCardInstance[]): string[] {
  return targets.map((target) => target.uid).sort();
}

function sameReplayTargets(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((uid, index) => uid === right[index]);
}
