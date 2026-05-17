import { getCards, hasZoneSpace, moveDuelCard, pushDuelLog, recordPreviousDuelCardState, resequence } from "#duel/card-state.js";
import { isControlChangePrevented, setControlPlayerForCard } from "#duel/continuous-effects.js";
import { collectDuelTriggerEffects } from "#duel/core.js";
import { availableForcedMonsterZoneCount, firstOpenForcedMonsterZoneSequence } from "#duel/forced-monster-zones.js";
import { phaseMask } from "#duel/phase-mask.js";
import { duelReason } from "#duel/reasons.js";
import { resetEvent, resetLeave, resetPhase } from "#duel/reset-flags.js";
import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import type { DuelEventPayload } from "#duel/event-history.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelLocation, DuelPhase, DuelSession, DuelState, PlayerId } from "#duel/types.js";

export const luaTemporaryControlReturnDescriptor = "temporary-control-return";
const locationReasonControl = 0x2;
type MonsterZoneSequenceSnapshot = Array<{ uid: string; sequence: number }>;

export function canLuaChangeControl(state: DuelState, card: DuelCardInstance, allowedLocations: DuelLocation[] | undefined, targetPlayer?: PlayerId, excludedUids: readonly string[] = [card.uid]): boolean {
  if (card.location !== "monsterZone" && card.location !== "spellTrapZone") return false;
  if (isControlChangePrevented(state, card, createLuaMaterialCheckContext(state))) return false;
  if (allowedLocations && !allowedLocations.includes(card.location)) return false;
  return targetPlayer === undefined || hasLuaControlZoneSpace(state, targetPlayer, card, excludedUids);
}

export function hasLuaControlZoneSpace(state: DuelState, targetPlayer: PlayerId, card: DuelCardInstance, excludedUids: readonly string[] = [card.uid]): boolean {
  if (card.location === "monsterZone") return availableForcedMonsterZoneCount(state, targetPlayer, excludedUids, 0, locationReasonControl, card) > 0;
  return hasZoneSpace(state, targetPlayer, card.location);
}

export function firstLuaControlMonsterZoneSequence(state: DuelState, targetPlayer: PlayerId, card: DuelCardInstance, excludedUids: readonly string[] = [card.uid]): number | undefined {
  return firstOpenForcedMonsterZoneSequence(state, targetPlayer, excludedUids, 0, locationReasonControl, card);
}

export function canLuaSwapControlPair(state: DuelState, left: DuelCardInstance, right: DuelCardInstance): boolean {
  if (left.uid === right.uid || left.controller === right.controller) return false;
  if (!canLuaChangeControl(state, left, undefined) || !canLuaChangeControl(state, right, undefined)) return false;
  return hasControlSwapSpace(state, left, right);
}

export function applyLuaContinuousSetControl(session: DuelSession, target: DuelCardInstance, reasonPlayer: PlayerId, payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): boolean {
  if (target.location !== "monsterZone" && target.location !== "spellTrapZone") return false;
  const targetPlayer = setControlPlayerForCard(session.state, target, createLuaMaterialCheckContext(session.state));
  if (targetPlayer === undefined || target.controller === targetPlayer) return false;
  if (!hasLuaControlZoneSpace(session.state, targetPlayer, target)) return false;
  const sequence = target.location === "monsterZone" ? firstLuaControlMonsterZoneSequence(session.state, targetPlayer, target) : undefined;
  const snapshot = target.location === "monsterZone" ? monsterZoneSequenceSnapshot(session.state, targetPlayer, [target.uid]) : undefined;
  const previousController = target.controller;
  moveDuelCard(session.state, target.uid, target.location, targetPlayer, duelReason.effect, reasonPlayer);
  if (snapshot) restoreMonsterZoneSequenceSnapshot(session.state, snapshot);
  if (sequence !== undefined) target.sequence = sequence;
  if (payload.eventReasonCardUid !== undefined) target.reasonCardUid = payload.eventReasonCardUid;
  if (payload.eventReasonEffectId !== undefined) target.reasonEffectId = payload.eventReasonEffectId;
  resequence(session.state, previousController, target.location);
  pushDuelLog(session.state, "control", targetPlayer, target.name, `Took control from player ${previousController}`);
  return true;
}

export function applyLuaContinuousSetControlEffects(session: DuelSession, reasonPlayer: PlayerId, payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId"> = {}): boolean {
  let changed = false;
  for (const card of [...session.state.cards]) {
    if (applyLuaContinuousSetControl(session, card, reasonPlayer, payload)) {
      collectDuelTriggerEffects(session.state, "controlChanged", card, { eventReason: duelReason.effect, eventReasonPlayer: reasonPlayer, ...payload });
      changed = true;
    }
  }
  return changed;
}

export function swapLuaCardControl(session: DuelSession, left: DuelCardInstance, right: DuelCardInstance, reasonPlayer: PlayerId): void {
  const leftController = left.controller;
  const rightController = right.controller;
  const excludedUids = [left.uid, right.uid];
  const leftSequence = left.location === "monsterZone" ? firstLuaControlMonsterZoneSequence(session.state, rightController, left, excludedUids) : undefined;
  const rightSequence = right.location === "monsterZone" ? firstLuaControlMonsterZoneSequence(session.state, leftController, right, excludedUids) : undefined;
  const leftTargetSnapshot = left.location === "monsterZone" ? monsterZoneSequenceSnapshot(session.state, rightController, excludedUids) : undefined;
  const rightTargetSnapshot = right.location === "monsterZone" ? monsterZoneSequenceSnapshot(session.state, leftController, excludedUids) : undefined;
  applyControlSwapCardState(session.state, left, rightController, reasonPlayer);
  applyControlSwapCardState(session.state, right, leftController, reasonPlayer);
  if (leftTargetSnapshot) restoreMonsterZoneSequenceSnapshot(session.state, leftTargetSnapshot);
  if (rightTargetSnapshot) restoreMonsterZoneSequenceSnapshot(session.state, rightTargetSnapshot);
  if (leftSequence !== undefined) left.sequence = leftSequence;
  if (rightSequence !== undefined) right.sequence = rightSequence;
  if (left.location !== "monsterZone") {
    resequence(session.state, leftController, left.location);
    resequence(session.state, rightController, left.location);
  }
  if (right.location !== "monsterZone") {
    resequence(session.state, leftController, right.location);
    resequence(session.state, rightController, right.location);
  }
  pushDuelLog(session.state, "control", rightController, left.name, `Swapped control with ${right.name}`);
  pushDuelLog(session.state, "control", leftController, right.name, `Swapped control with ${left.name}`);
}

export function createLuaTemporaryControlReturnEffect(card: DuelCardInstance, returnPlayer: PlayerId, phase: DuelPhase, count: number): DuelEffectDefinition {
  return {
    id: `lua-temp-control-return-${card.uid}`,
    sourceUid: card.uid,
    controller: returnPlayer,
    ownerPlayer: returnPlayer,
    registryKey: `lua:${card.code}:temporary-control-return:${card.uid}`,
    event: "continuous",
    code: 0x1000 | phaseMask(phase),
    value: returnPlayer,
    luaValueDescriptor: luaTemporaryControlReturnDescriptor,
    range: [card.location],
    reset: { flags: resetEvent | resetLeave | resetPhase | phaseMask(phase), count },
    operation: luaTemporaryControlReturnOperation(returnPlayer),
  };
}

export function registerLuaTemporaryControlReturnEffect(session: DuelSession, card: DuelCardInstance, returnPlayer: PlayerId, phaseMaskValue: number, count: number): void {
  const phase = luaControlReturnPhase(phaseMaskValue);
  if (phase) session.state.effects.push(createLuaTemporaryControlReturnEffect(card, returnPlayer, phase, count));
}

export function luaTemporaryControlReturnOperation(returnPlayer: PlayerId | undefined): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const card = ctx.source;
    const targetPlayer = returnPlayer ?? card.previousController;
    if (targetPlayer !== 0 && targetPlayer !== 1) return;
    if (card.controller === targetPlayer) return;
    if (card.location !== "monsterZone" && card.location !== "spellTrapZone") return;
    if (!hasLuaControlZoneSpace(ctx.duel, targetPlayer, card)) return;
    const sequence = card.location === "monsterZone" ? firstLuaControlMonsterZoneSequence(ctx.duel, targetPlayer, card) : undefined;
    const snapshot = card.location === "monsterZone" ? monsterZoneSequenceSnapshot(ctx.duel, targetPlayer, [card.uid]) : undefined;
    const previousController = card.controller;
    moveDuelCard(ctx.duel, card.uid, card.location, targetPlayer, duelReason.return, previousController);
    if (snapshot) restoreMonsterZoneSequenceSnapshot(ctx.duel, snapshot);
    if (sequence !== undefined) card.sequence = sequence;
    resequence(ctx.duel, previousController, card.location);
    pushDuelLog(ctx.duel, "control", targetPlayer, card.name, `Returned control to player ${targetPlayer}`);
  };
}

function luaControlReturnPhase(mask: number): DuelPhase | undefined {
  if ((mask & 0x1) !== 0) return "draw";
  if ((mask & 0x2) !== 0) return "standby";
  if ((mask & 0x4) !== 0) return "main1";
  if ((mask & 0x80) !== 0) return "battle";
  if ((mask & 0x100) !== 0) return "main2";
  if ((mask & 0x200) !== 0) return "end";
  return undefined;
}

function hasControlSwapSpace(state: DuelState, left: DuelCardInstance, right: DuelCardInstance): boolean {
  const cards = [left, right];
  const excludedUids = cards.map((card) => card.uid);
  return [left.controller, right.controller].every((player) => {
    for (const location of ["monsterZone", "spellTrapZone"] as const) {
      const outgoing = cards.filter((card) => card.controller === player && card.location === location);
      const incoming = cards.filter((card) => card.controller !== player && card.location === location);
      const current = getCards(state, player, location).length;
      if (current - outgoing.length + incoming.length > 5) return false;
      if (location === "monsterZone" && incoming.length > 0) {
        const available = availableForcedMonsterZoneCount(state, player, excludedUids, 0, locationReasonControl, incoming[0]);
        if (available < incoming.length) return false;
      }
    }
    return true;
  });
}

function applyControlSwapCardState(state: DuelState, card: DuelCardInstance, controller: PlayerId, reasonPlayer: PlayerId): void {
  recordPreviousDuelCardState(state, card);
  card.reason = duelReason.effect;
  card.reasonPlayer = reasonPlayer;
  card.controller = controller;
}

function monsterZoneSequenceSnapshot(state: DuelState, player: PlayerId, excludedUids: readonly string[]): MonsterZoneSequenceSnapshot {
  return state.cards
    .filter((card) => card.controller === player && card.location === "monsterZone" && !excludedUids.includes(card.uid))
    .map((card) => ({ uid: card.uid, sequence: card.sequence }));
}

function restoreMonsterZoneSequenceSnapshot(state: DuelState, snapshot: MonsterZoneSequenceSnapshot): void {
  for (const { uid, sequence } of snapshot) {
    const card = state.cards.find((candidate) => candidate.uid === uid && candidate.location === "monsterZone");
    if (card) card.sequence = sequence;
  }
}
