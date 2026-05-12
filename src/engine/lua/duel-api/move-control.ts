import { getCards, hasZoneSpace, moveDuelCard, pushDuelLog, recordPreviousDuelCardState, resequence } from "#duel/card-state.js";
import { isControlChangePrevented, setControlPlayerForCard } from "#duel/continuous-effects.js";
import { phaseMask } from "#duel/phase-mask.js";
import { duelReason } from "#duel/reasons.js";
import { resetEvent, resetLeave, resetPhase } from "#duel/reset-flags.js";
import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import type { DuelEventPayload } from "#duel/event-history.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelLocation, DuelPhase, DuelSession, DuelState, PlayerId } from "#duel/types.js";

export const luaTemporaryControlReturnDescriptor = "temporary-control-return";

export function canLuaChangeControl(state: DuelState, card: DuelCardInstance, allowedLocations: DuelLocation[] | undefined): boolean {
  if (card.location !== "monsterZone" && card.location !== "spellTrapZone") return false;
  if (isControlChangePrevented(state, card, createLuaMaterialCheckContext(state))) return false;
  return !allowedLocations || allowedLocations.includes(card.location);
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
  if (!hasZoneSpace(session.state, targetPlayer, target.location)) return false;
  const previousController = target.controller;
  moveDuelCard(session.state, target.uid, target.location, targetPlayer, duelReason.effect, reasonPlayer);
  if (payload.eventReasonCardUid !== undefined) target.reasonCardUid = payload.eventReasonCardUid;
  if (payload.eventReasonEffectId !== undefined) target.reasonEffectId = payload.eventReasonEffectId;
  resequence(session.state, previousController, target.location);
  pushDuelLog(session.state, "control", targetPlayer, target.name, `Took control from player ${previousController}`);
  return true;
}

export function swapLuaCardControl(session: DuelSession, left: DuelCardInstance, right: DuelCardInstance, reasonPlayer: PlayerId): void {
  const leftController = left.controller;
  const rightController = right.controller;
  applyControlSwapCardState(session.state, left, rightController, reasonPlayer);
  applyControlSwapCardState(session.state, right, leftController, reasonPlayer);
  resequence(session.state, leftController, left.location);
  resequence(session.state, rightController, left.location);
  resequence(session.state, leftController, right.location);
  resequence(session.state, rightController, right.location);
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
    if (!hasZoneSpace(ctx.duel, targetPlayer, card.location)) return;
    const previousController = card.controller;
    moveDuelCard(ctx.duel, card.uid, card.location, targetPlayer, duelReason.return, previousController);
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
  return [left.controller, right.controller].every((player) =>
    (["monsterZone", "spellTrapZone"] as const).every((location) => {
      const current = getCards(state, player, location).length;
      const outgoing = [left, right].filter((card) => card.controller === player && card.location === location).length;
      const incoming = [left, right].filter((card) => card.controller !== player && card.location === location).length;
      return current - outgoing + incoming <= 5;
    }),
  );
}

function applyControlSwapCardState(state: DuelState, card: DuelCardInstance, controller: PlayerId, reasonPlayer: PlayerId): void {
  recordPreviousDuelCardState(state, card);
  card.reason = duelReason.effect;
  card.reasonPlayer = reasonPlayer;
  card.controller = controller;
}
