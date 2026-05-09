import { getCards, pushDuelLog, resequence } from "#duel/card-state.js";
import { isControlChangePrevented } from "#duel/continuous-effects.js";
import { duelReason } from "#duel/reasons.js";
import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import type { DuelCardInstance, DuelLocation, DuelSession, DuelState, PlayerId } from "#duel/types.js";

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

export function swapLuaCardControl(session: DuelSession, left: DuelCardInstance, right: DuelCardInstance, reasonPlayer: PlayerId): void {
  const leftController = left.controller;
  const rightController = right.controller;
  applyControlSwapCardState(left, rightController, reasonPlayer);
  applyControlSwapCardState(right, leftController, reasonPlayer);
  resequence(session.state, leftController, left.location);
  resequence(session.state, rightController, left.location);
  resequence(session.state, leftController, right.location);
  resequence(session.state, rightController, right.location);
  pushDuelLog(session.state, "control", rightController, left.name, `Swapped control with ${right.name}`);
  pushDuelLog(session.state, "control", leftController, right.name, `Swapped control with ${left.name}`);
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

function applyControlSwapCardState(card: DuelCardInstance, controller: PlayerId, reasonPlayer: PlayerId): void {
  card.previousLocation = card.location;
  card.previousController = card.controller;
  card.previousSequence = card.sequence;
  card.previousPosition = card.position;
  card.previousFaceUp = card.faceUp;
  card.reason = duelReason.effect;
  card.reasonPlayer = reasonPlayer;
  card.controller = controller;
}
