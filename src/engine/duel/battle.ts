import { findCard, getCards, pushDuelLog, requireControlledCard } from "#duel/card-state.js";
import { recordAttackActivity } from "#duel/activity.js";
import { duelReason } from "#duel/reasons.js";
import type { CardPosition, DuelAction, DuelCardInstance, DuelEventName, DuelState, PlayerId } from "#duel/types.js";

export interface DuelBattleCallbacks {
  collectEvent(eventName: DuelEventName, eventCard?: DuelCardInstance): void;
  damagePlayer(player: PlayerId, amount: number): number;
  destroyCard(uid: string, controller?: PlayerId, reason?: number): DuelCardInstance;
}

export function canDuelCardAttack(state: DuelState, uid: string): boolean {
  const card = findCard(state, uid);
  return Boolean(card && canAttackWithCard(state, card));
}

export function getDuelAttackTargets(state: DuelState, attackerUid: string): DuelCardInstance[] {
  const attacker = findCard(state, attackerUid);
  if (!attacker || !canAttackWithCard(state, attacker)) return [];
  return getAttackTargets(state, attacker.controller);
}

export function declareDuelAttack(state: DuelState, player: PlayerId, attackerUid: string, targetUid: string | undefined, callbacks: DuelBattleCallbacks): void {
  const attacker = requireControlledCard(state, player, attackerUid, "monsterZone");
  if (state.phase !== "battle") throw new Error("Attacks can only be declared during the battle phase");
  if (!canAttackWithCard(state, attacker)) throw new Error(`${attacker.name} cannot attack`);

  const targets = getAttackTargets(state, player);
  const target = targetUid === undefined ? undefined : findCard(state, targetUid);
  if (targets.length > 0) {
    if (!target || !targets.some((candidate) => candidate.uid === target.uid)) throw new Error("Attack target is not legal");
  } else if (targetUid !== undefined) {
    throw new Error("Direct attacks cannot have a target");
  }

  state.attacksDeclared.push(attacker.uid);
  recordAttackActivity(state, player, attacker);
  state.currentAttack = { attackerUid: attacker.uid, ...(target === undefined ? {} : { targetUid: target.uid }) };
  state.pendingBattle = { ...state.currentAttack };
  state.battleStep = "attack";
  if (!target) {
    pushDuelLog(state, "attack", player, attacker.name, "Direct attack");
    callbacks.collectEvent("attackDeclared", attacker);
    return;
  }

  pushDuelLog(state, "attack", player, attacker.name, `Attacked ${target.name}`);
  callbacks.collectEvent("attackDeclared", attacker);
}

export function negateDuelAttack(state: DuelState): boolean {
  const attack = state.currentAttack;
  if (!attack) return false;
  const attacker = findCard(state, attack.attackerUid);
  delete state.currentAttack;
  delete state.pendingBattle;
  state.attackPasses = [];
  state.damagePasses = [];
  delete state.battleStep;
  pushDuelLog(state, "attack", attacker?.controller ?? state.turnPlayer, attacker?.name, "Negated attack");
  return true;
}

export function resolvePendingDuelBattle(state: DuelState, callbacks: DuelBattleCallbacks): boolean {
  const pending = state.pendingBattle;
  if (!pending) return false;
  const attacker = findCard(state, pending.attackerUid);
  if (!attacker || attacker.location !== "monsterZone") {
    delete state.pendingBattle;
    delete state.currentAttack;
    state.attackPasses = [];
    state.damagePasses = [];
    delete state.battleStep;
    return false;
  }
  const target = pending.targetUid === undefined ? undefined : findCard(state, pending.targetUid);
  delete state.pendingBattle;
  delete state.currentAttack;
  state.attackPasses = [];
  state.damagePasses = [];
  delete state.battleStep;
  if (!target) {
    callbacks.damagePlayer(otherPlayer(attacker.controller), getBattleAttack(attacker));
    return true;
  }
  if (target.location === "monsterZone") resolveBattle(state, attacker, target, callbacks);
  return true;
}

export function canChangeDuelCardPosition(state: DuelState, uid: string, position: CardPosition): boolean {
  const card = findCard(state, uid);
  if (!card || card.location !== "monsterZone") return false;
  if (!isMonsterLike(card)) return false;
  if (!isMonsterPosition(position)) return false;
  if (card.position === position) return false;
  if (state.positionsChanged.includes(card.uid)) return false;
  if (state.attacksDeclared.includes(card.uid)) return false;
  return true;
}

export function changeDuelCardPosition(state: DuelState, player: PlayerId, uid: string, position: CardPosition, collectEvent: DuelBattleCallbacks["collectEvent"]): DuelCardInstance {
  const card = requireControlledCard(state, player, uid, "monsterZone");
  if (!canChangeDuelCardPosition(state, uid, position)) throw new Error(`${card.name} cannot change to ${position}`);
  card.position = position;
  card.faceUp = position !== "faceDownDefense";
  state.positionsChanged.push(card.uid);
  pushDuelLog(state, "changePosition", player, card.name, position);
  collectEvent("positionChanged", card);
  return card;
}

export function positionChangeActions(state: DuelState, player: PlayerId): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const card of getCards(state, player, "monsterZone")) {
    for (const position of nextManualPositions(card)) {
      if (canChangeDuelCardPosition(state, card.uid, position)) {
        actions.push({ type: "changePosition", player, uid: card.uid, position, label: `${card.name}: Change to ${positionLabel(position)}` });
      }
    }
  }
  return actions;
}

export function attackActions(state: DuelState, player: PlayerId): DuelAction[] {
  const actions: DuelAction[] = [];
  const attackers = getCards(state, player, "monsterZone").filter((card) => canAttackWithCard(state, card));
  const targets = getAttackTargets(state, player);
  for (const attacker of attackers) {
    if (targets.length === 0) {
      actions.push({ type: "declareAttack", player, attackerUid: attacker.uid, label: `${attacker.name}: Direct attack` });
      continue;
    }
    for (const target of targets) {
      actions.push({ type: "declareAttack", player, attackerUid: attacker.uid, targetUid: target.uid, label: `${attacker.name}: Attack ${target.name}` });
    }
  }
  return actions;
}

function nextManualPositions(card: DuelCardInstance): CardPosition[] {
  if (card.position === "faceUpAttack") return ["faceUpDefense"];
  if (card.position === "faceUpDefense") return ["faceUpAttack"];
  if (card.position === "faceDownDefense") return ["faceUpAttack"];
  return [];
}

function positionLabel(position: CardPosition): string {
  if (position === "faceUpAttack") return "Attack";
  if (position === "faceUpDefense") return "Defense";
  if (position === "faceDownDefense") return "face-down Defense";
  return position;
}

function canAttackWithCard(state: DuelState, card: DuelCardInstance): boolean {
  if (state.phase !== "battle") return false;
  if (card.location !== "monsterZone" || card.controller !== state.turnPlayer) return false;
  if (!isMonsterLike(card) || !card.faceUp) return false;
  if (card.position !== "faceUpAttack") return false;
  return !state.attacksDeclared.includes(card.uid);
}

function getAttackTargets(state: DuelState, player: PlayerId): DuelCardInstance[] {
  return getCards(state, otherPlayer(player), "monsterZone").filter((card) => isMonsterLike(card));
}

function resolveBattle(state: DuelState, attacker: DuelCardInstance, target: DuelCardInstance, callbacks: DuelBattleCallbacks): void {
  const attackerAttack = getBattleAttack(attacker);
  const targetStat = target.position === "faceUpAttack" ? getBattleAttack(target) : getBattleDefense(target);
  if (target.position === "faceUpAttack") {
    resolveAttackPositionBattle(state, attacker, attackerAttack, target, targetStat, callbacks);
    return;
  }
  resolveDefensePositionBattle(state, attacker, attackerAttack, target, targetStat, callbacks);
}

function resolveAttackPositionBattle(state: DuelState, attacker: DuelCardInstance, attackerAttack: number, target: DuelCardInstance, targetAttack: number, callbacks: DuelBattleCallbacks): void {
  if (attackerAttack > targetAttack) {
    if (destroyBattleCard(target, callbacks)) callbacks.collectEvent("battleDestroyed", target);
    callbacks.damagePlayer(target.controller, attackerAttack - targetAttack);
    return;
  }
  if (attackerAttack < targetAttack) {
    if (destroyBattleCard(attacker, callbacks)) callbacks.collectEvent("battleDestroyed", attacker);
    callbacks.damagePlayer(attacker.controller, targetAttack - attackerAttack);
    return;
  }
  if (destroyBattleCard(attacker, callbacks)) callbacks.collectEvent("battleDestroyed", attacker);
  if (destroyBattleCard(target, callbacks)) callbacks.collectEvent("battleDestroyed", target);
}

function resolveDefensePositionBattle(state: DuelState, attacker: DuelCardInstance, attackerAttack: number, target: DuelCardInstance, targetDefense: number, callbacks: DuelBattleCallbacks): void {
  if (attackerAttack > targetDefense) {
    if (destroyBattleCard(target, callbacks)) callbacks.collectEvent("battleDestroyed", target);
    return;
  }
  if (attackerAttack < targetDefense) callbacks.damagePlayer(attacker.controller, targetDefense - attackerAttack);
}

function destroyBattleCard(card: DuelCardInstance, callbacks: DuelBattleCallbacks): boolean {
  const previousLocation = card.location;
  const result = callbacks.destroyCard(card.uid, card.controller, duelReason.battle | duelReason.destroy);
  return result.uid === card.uid && result.location !== previousLocation;
}

function getBattleAttack(card: DuelCardInstance): number {
  return Math.max(0, card.data.attack ?? 0);
}

function getBattleDefense(card: DuelCardInstance): number {
  return Math.max(0, card.data.defense ?? 0);
}

function isMonsterLike(card: DuelCardInstance): boolean {
  return card.kind === "monster" || card.kind === "extra";
}

function isMonsterPosition(position: CardPosition): boolean {
  return position === "faceUpAttack" || position === "faceUpDefense" || position === "faceDownDefense";
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
