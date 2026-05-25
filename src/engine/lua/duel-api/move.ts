import fengari from "fengari";
import { recordSpecialSummonActivity } from "#duel/activity.js";
import { getCards, hasZoneSpace, pushDuelLog, resequence } from "#duel/card-state.js";
import { firstOpenFieldZoneSequence, isFieldZoneDisabled } from "#duel/disabled-field-zones.js";
import { eventCardReasonPayload, type DuelEventPayload } from "#duel/event-history.js";
import { setWaitingForPendingTriggerBucket } from "#duel/trigger-buckets.js";
import {
  banishDuelCard,
  canChangeDuelCardPosition,
  canMoveDuelCardToLocation,
  canPlayerSpecialSummon,
  changeDuelCardPosition,
  collectDuelGroupedTriggerEffects,
  collectDuelTriggerEffects,
  moveDuelCard,
  moveDuelCardWithRedirects,
  sendDuelCardToGraveyard,
  specialSummonDuelCard,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { duelSummonTypeFromCode, luaSpecialSummonTypeCode } from "#duel/summon-type-codes.js";
import { locationsFromMask, positionFromMask, readCardUid } from "#lua/api-utils.js";
import { moveDeckCardToBottom, moveDeckCardToTop } from "#lua/duel-api/deck-order.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { activeFieldSpell, isDuelType, isFieldSpell } from "#lua/duel-api/field-spell-state.js";
import { applyLuaContinuousSetControl, canLuaChangeControl, canLuaSwapControlPair, firstLuaControlMonsterZoneSequence, registerLuaTemporaryControlReturnEffect, swapLuaCardControl } from "#lua/duel-api/move-control.js";
import { luaMoveBlockedByImmunity, type LuaMoveImmunityHostState } from "#lua/duel-api/move-immunity.js";
import { applyLuaMovePosition, bindLuaEquipTarget, changeSpellTrapPosition, didMove, faceupAttackOrFacedownDefensePosition, movementSnapshot } from "#lua/duel-api/move-card-state.js";
import { pushDestroyHelper } from "#lua/duel-api/move-destroy.js";
import { shuffleLuaMoveCards } from "#lua/duel-api/move-shuffle.js";
import { readCardOrGroupUids, readFieldDestination, readMoveReason, readOptionalPlayer, readSingleDestination } from "#lua/duel-api/move-readers.js";
import { installDuelOverlayApi, removeOverlayReference } from "#lua/duel-api/overlay.js";
import { applyMonsterZoneMask, hasOpenMonsterZone, monsterZoneSequenceSnapshot, restoreMonsterZoneSequenceSnapshot } from "#lua/monster-zone-mask.js";
import type { CardPosition, DuelCardInstance, DuelEffectContext, DuelEventName, DuelLocation, DuelSession, DuelState, PlayerId } from "#duel/types.js";
const { lua, to_luastring } = fengari;
type LuaCardMover = (state: DuelState, uid: string, controller?: PlayerId, reason?: number, reasonPlayer?: PlayerId, payload?: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId">) => DuelCardInstance;

export interface LuaOperationTimingBoundaryHostState {
  activeContext?: DuelEffectContext | undefined;
  activeOperationTriggerStart?: number | undefined;
  activeOperationMoved?: boolean | undefined;
  pendingSetLpDefeat?: boolean | undefined;
}

export interface LuaDuelMoveApiHostState extends LuaMoveImmunityHostState {
  operatedUids: string[];
  summonNegatedUids: string[];
  activeContext?: DuelEffectContext | undefined;
  activeOperationTriggerStart?: number | undefined;
  activeOperationMoved?: boolean;
}

export function installDuelMoveApi(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushSendToGenericLocation(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("Sendto"));
  pushMoveHelper(L, "SendtoGrave", session, hostState, (state, uid, controller, reason, reasonPlayer, payload) => sendDuelCardToGraveyard(state, uid, controller, reason, reasonPlayer, payload));
  pushDestroyHelper(L, session, hostState, {
    beginMoveStep: beginLuaOperationMoveStep,
    finishMoveStep: finishLuaOperationMoveStep,
    assignReasonCard,
    regroupEvent: regroupLuaOperationEvent,
    setOperatedUids,
  });
  lua.lua_pushcfunction(L, (state: unknown) => pushRemove(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("Remove"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveCards(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RemoveCards"));
  pushMoveHelper(L, "Release", session, hostState, (state, uid, controller, reason, reasonPlayer, payload) => sendDuelCardToGraveyard(state, uid, controller, reason, reasonPlayer, payload), duelReason.release);
  pushMoveToLocationHelper(L, "SendtoHand", session, hostState, "hand", 3);
  pushMoveToLocationHelper(L, "SendtoDeck", session, hostState, "deck", 4);
  pushMoveToLocationHelper(L, "SendtoExtraP", session, hostState, "extraDeck", 3);
  pushMoveToLocationHelper(L, "SendtoExtra", session, hostState, "extraDeck", 3);
  installDuelOverlayApi(L, session, hostState);
  lua.lua_pushcfunction(L, (state: unknown) => pushSpecialSummon(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SpecialSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushEquip(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("Equip"));
  lua.lua_pushcfunction(L, () => 0);
  lua.lua_setfield(L, -2, to_luastring("EquipComplete"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetControl(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetControl"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSwapControl(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SwapControl"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChangePosition(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ChangePosition"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChangeToFaceupAttackOrFacedownDefense(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ChangeToFaceupAttackOrFacedownDefense"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMoveToField(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("MoveToField"));
  lua.lua_pushcfunction(L, (state: unknown) => pushActivateFieldSpell(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ActivateFieldSpell"));
  lua.lua_pushcfunction(L, (state: unknown) => pushReturnToField(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ReturnToField"));
  lua.lua_pushcfunction(L, (state: unknown) => pushReturnToGrave(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ReturnToGrave"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMoveToDeckTop(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("MoveToDeckTop"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMoveToDeckBottom(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("MoveToDeckBottom"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSwapSequence(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SwapSequence"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMoveSequence(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("MoveSequence"));
  lua.lua_pushcfunction(L, (state: unknown) => pushShuffleSetCard(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ShuffleSetCard"));
}
function pushSendToGenericLocation(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const location = readSingleDestination(L, 2);
  if (!location) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const reason = readMoveReason(L, 3, 0);
  const requestedPosition = lua.lua_isnumber(L, 4) ? positionFromMask(lua.lua_tointeger(L, 4)) : undefined;
  const moved: string[] = [];
  beginLuaOperationMoveStep(session, hostState);
  const triggerStart = session.state.pendingTriggers.length;
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    if (luaMoveBlockedByImmunity(L, session, hostState, card, reason)) continue;
    const before = movementSnapshot(card);
    try {
      const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
      const result = moveGenericDuelCardToLocation(session, uid, location, card.controller, reason, reasonPlayer, luaEffectReasonPayload(hostState, reason ?? 0, reasonPlayer));
      assignReasonCard(result, hostState);
      if (requestedPosition) applyLuaMovePosition(result, requestedPosition);
      if (didMove(result, before)) moved.push(uid);
    } catch {
      // Generic movement reports successful card moves only.
    }
  }
  finishLuaOperationMoveStep(hostState, moved.length > 0);
  regroupGenericDestinationEvents(session, triggerStart, moved);
  setOperatedUids(hostState, moved);
  lua.lua_pushinteger(L, moved.length);
  return 1;
}
function pushMoveHelper(L: unknown, fieldName: string, session: DuelSession, hostState: LuaDuelMoveApiHostState, mover: LuaCardMover, extraReason = 0): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const groupedEventName = fieldName === "Destroy" ? "destroyed" : fieldName === "SendtoGrave" ? "sentToGraveyard" : fieldName === "Release" ? "released" : undefined;
    const groupedLocation = fieldName === "SendtoGrave" ? "graveyard" : undefined;
    const moved = moveCardOrGroup(session, state, hostState, mover, extraReason, groupedEventName, groupedLocation);
    setOperatedUids(hostState, moved);
    lua.lua_pushinteger(state, moved.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}
function pushMoveToLocationHelper(L: unknown, fieldName: string, session: DuelSession, hostState: LuaDuelMoveApiHostState, location: DuelLocation, reasonIndex: number): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const moved = moveCardOrGroupToLocation(session, state, hostState, location, reasonIndex);
    setOperatedUids(hostState, moved);
    lua.lua_pushinteger(state, moved.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}
function moveGenericDuelCardToLocation(
  session: DuelSession,
  uid: string,
  location: DuelLocation,
  controller: PlayerId,
  reason: number | undefined,
  reasonPlayer: PlayerId,
  payload: Pick<DuelEventPayload, "eventReasonCardUid" | "eventReasonEffectId">,
): DuelCardInstance {
  if (location === "graveyard") return sendDuelCardToGraveyard(session.state, uid, controller, reason, reasonPlayer, payload);
  if (location === "banished") return banishDuelCard(session.state, uid, controller, reason, reasonPlayer, payload);
  return moveDuelCardWithRedirects(session.state, uid, location, controller, reason, reasonPlayer, payload);
}
function pushRemoveCards(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  if (session.state.status === "ended") {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const requested = new Set(readCardOrGroupUids(L, 1));
  const removed = session.state.cards.filter((card) => requested.has(card.uid)).map((card) => card.uid);
  if (removed.length > 0) {
    for (const uid of removed) removeOverlayReference(session.state, uid);
    session.state.cards = session.state.cards.filter((card) => !requested.has(card.uid));
  }
  setOperatedUids(hostState, removed);
  lua.lua_pushinteger(L, removed.length);
  return 1;
}
function pushRemove(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const requestedPosition = lua.lua_isnumber(L, 2) ? positionFromMask(lua.lua_tointeger(L, 2)) : undefined;
  const reason = readMoveReason(L, 3, 0);
  const moved: string[] = [];
  beginLuaOperationMoveStep(session, hostState);
  const triggerStart = session.state.pendingTriggers.length;
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    if (luaMoveBlockedByImmunity(L, session, hostState, card, reason)) continue;
    const before = movementSnapshot(card);
    try {
      const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer, result = banishDuelCard(session.state, uid, card.controller, reason, reasonPlayer, luaEffectReasonPayload(hostState, reason ?? 0, reasonPlayer));
      assignReasonCard(result, hostState);
      if (requestedPosition) applyLuaMovePosition(result, requestedPosition);
      if (didMove(result, before)) moved.push(uid);
    } catch {
      // EDOPro-style removal reports successful card moves only.
    }
  }
  finishLuaOperationMoveStep(hostState, moved.length > 0);
  regroupLuaOperationEvent(session, triggerStart, "moved", moved);
  regroupLuaOperationEvent(session, triggerStart, "leftField", moved.filter((uid) => session.state.cards.some((card) => card.uid === uid && (card.previousLocation === "monsterZone" || card.previousLocation === "spellTrapZone") && card.location !== "monsterZone" && card.location !== "spellTrapZone")));
  regroupLuaOperationEvent(session, triggerStart, "leftGraveyard", moved.filter((uid) => session.state.cards.some((card) => card.uid === uid && card.previousLocation === "graveyard")));
  regroupLuaOperationEvent(session, triggerStart, "banished", moved, "banished");
  setOperatedUids(hostState, moved);
  lua.lua_pushinteger(L, moved.length);
  return 1;
}
function pushSpecialSummon(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const uids = readCardOrGroupUids(L, 1);
  const summonType = luaSpecialSummonTypeCode(lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0);
  const targetPlayer = readOptionalPlayer(L, 4);
  const ignoreSummonCondition = lua.lua_toboolean(L, 5);
  const requestedPosition = lua.lua_isnumber(L, 7) ? positionFromMask(lua.lua_tointeger(L, 7)) : undefined;
  const zoneMask = lua.lua_isnumber(L, 8) ? lua.lua_tointeger(L, 8) : undefined;
  const moved: string[] = [], summonedCards: DuelCardInstance[] = [];
  let successPayload: DuelEventPayload | undefined;
  beginLuaOperationMoveStep(session, hostState);
  for (const uid of uids) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    const player = targetPlayer ?? card.controller;
    if (luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect | duelReason.summon | duelReason.specialSummon)) continue;
    if (!hasOpenMonsterZone(session, player, zoneMask)) continue;
    try {
      const reasonPlayer = hostState.activeContext?.player ?? player;
      const payload = luaEffectReasonPayload(hostState, duelReason.summon | duelReason.specialSummon, reasonPlayer);
      const presetMaterialUids = summonType !== 0 ? [...(card.summonMaterialUids ?? [])] : [];
      const existingMonsterSequences = zoneMask === undefined ? [] : monsterZoneSequenceSnapshot(session, player, uid);
      const summoned = specialSummonDuelCard(session.state, uid, player, reasonPlayer, payload, summonType, false, ignoreSummonCondition, requestedPosition);
      restoreMonsterZoneSequenceSnapshot(session, existingMonsterSequences);
      if (presetMaterialUids.length > 0) summoned.summonMaterialUids = presetMaterialUids;
      if (requestedPosition) applyLuaMovePosition(summoned, requestedPosition);
      applyMonsterZoneMask(session, summoned, player, zoneMask);
      successPayload ??= payload;
      summonedCards.push(summoned);
      moved.push(uid);
    } catch {
      const reasonPlayer = hostState.activeContext?.player ?? player;
      const payload = luaEffectReasonPayload(hostState, duelReason.summon | duelReason.specialSummon, reasonPlayer);
      const summoned = specialSummonExplicitExtraDeckCard(session, card, player, summonType, reasonPlayer, payload, requestedPosition, zoneMask, hostState, false);
      if (!card || !summoned) continue;
      successPayload ??= payload;
      summonedCards.push(summoned);
      moved.push(uid);
    }
  }
  if (summonedCards.length > 0) collectDuelGroupedTriggerEffects(session.state, "specialSummoned", summonedCards, { ...(successPayload ?? {}), eventUids: moved });
  finishLuaOperationMoveStep(hostState, moved.length > 0);
  setOperatedUids(hostState, moved);
  lua.lua_pushinteger(L, moved.length);
  return 1;
}
function pushEquip(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const player = readOptionalPlayer(L, 1) ?? session.state.turnPlayer;
  const equipUid = readCardUid(L, 2);
  const targetUid = readCardUid(L, 3);
  const equipCard = equipUid ? session.state.cards.find((candidate) => candidate.uid === equipUid) : undefined;
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (
    !equipUid ||
    !equipCard ||
    !target ||
    target.location !== "monsterZone" ||
    !hasZoneSpace(session.state, player, "spellTrapZone") ||
    luaMoveBlockedByImmunity(L, session, hostState, equipCard, duelReason.effect) ||
    luaMoveBlockedByImmunity(L, session, hostState, target, duelReason.effect)
  ) {
    setOperatedUids(hostState, []);
    lua.lua_pushboolean(L, false);
    return 1;
  }
  beginLuaOperationMoveStep(session, hostState);
  try {
    const reasonPlayer = hostState.activeContext?.player ?? player, payload = luaEffectReasonPayload(hostState, duelReason.effect, reasonPlayer);
    moveDuelCard(session.state, equipUid, "spellTrapZone", player, duelReason.effect, reasonPlayer);
    assignReasonCard(equipCard, hostState);
    bindLuaEquipTarget(equipCard, target);
    pushDuelLog(session.state, "equip", player, equipCard.name, `Equipped to ${target.name}`);
    collectLuaMoveEvent(session, "equipped", equipCard);
    if (applyLuaContinuousSetControl(session, target, reasonPlayer, payload)) collectLuaMoveEvent(session, "controlChanged", target);
    setOperatedUids(hostState, [equipUid]);
    finishLuaOperationMoveStep(hostState, true);
    lua.lua_pushboolean(L, true);
    return 1;
  } catch {
    setOperatedUids(hostState, []);
    finishLuaOperationMoveStep(hostState, false);
    lua.lua_pushboolean(L, false);
    return 1;
  }
}
function pushGetControl(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const targetPlayer = readOptionalPlayer(L, 2);
  if (targetPlayer === undefined) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const returnPhaseMask = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  const returnCount = lua.lua_isnumber(L, 4) ? Math.max(1, lua.lua_tointeger(L, 4)) : 1;
  const allowedLocations = lua.lua_isnumber(L, 5) ? locationsFromMask(lua.lua_tointeger(L, 5)) : undefined;
  const controlled: string[] = [];
  beginLuaOperationMoveStep(session, hostState);
  const triggerStart = session.state.pendingTriggers.length;
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card || card.controller === targetPlayer || !canLuaChangeControl(session.state, card, allowedLocations, targetPlayer) || luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)) continue;
    const sequence = card.location === "monsterZone" ? firstLuaControlMonsterZoneSequence(session.state, targetPlayer, card) : undefined;
    const existingMonsterSequences = card.location === "monsterZone" ? monsterZoneSequenceSnapshot(session, targetPlayer, uid) : undefined;
    const previousController = card.controller;
    try {
      moveDuelCard(session.state, uid, card.location, targetPlayer, duelReason.effect, hostState.activeContext?.player ?? session.state.turnPlayer);
      if (existingMonsterSequences) restoreMonsterZoneSequenceSnapshot(session, existingMonsterSequences);
      if (sequence !== undefined) card.sequence = sequence;
      assignReasonCard(card, hostState);
      resequence(session.state, previousController, card.location);
      pushDuelLog(session.state, "control", targetPlayer, card.name, `Took control from player ${previousController}`);
      collectLuaMoveEvent(session, "controlChanged", card);
      registerLuaTemporaryControlReturnEffect(session, card, previousController, returnPhaseMask, returnCount);
      controlled.push(uid);
    } catch {
      // EDOPro-style helpers report successful control changes only.
    }
  }
  finishLuaOperationMoveStep(hostState, controlled.length > 0);
  regroupLuaOperationEvent(session, triggerStart, "controlChanged", controlled);
  setOperatedUids(hostState, controlled);
  lua.lua_pushinteger(L, controlled.length);
  return 1;
}

function pushSwapControl(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const leftUids = readCardOrGroupUids(L, 1);
  const rightUids = readCardOrGroupUids(L, 2);
  const count = Math.min(leftUids.length, rightUids.length);
  const swapped: string[] = [];
  beginLuaOperationMoveStep(session, hostState);
  const triggerStart = session.state.pendingTriggers.length;
  for (let index = 0; index < count; index += 1) {
    const left = session.state.cards.find((candidate) => candidate.uid === leftUids[index]);
    const right = session.state.cards.find((candidate) => candidate.uid === rightUids[index]);
    if (!left || !right || !canLuaSwapControlPair(session.state, left, right)) continue;
    if (luaMoveBlockedByImmunity(L, session, hostState, left, duelReason.effect) || luaMoveBlockedByImmunity(L, session, hostState, right, duelReason.effect)) continue;
    swapLuaCardControl(session, left, right, hostState.activeContext?.player ?? session.state.turnPlayer);
    assignReasonCard(left, hostState);
    assignReasonCard(right, hostState);
    collectLuaMoveEvent(session, "controlChanged", left);
    collectLuaMoveEvent(session, "controlChanged", right);
    swapped.push(left.uid, right.uid);
  }
  finishLuaOperationMoveStep(hostState, swapped.length > 0);
  regroupLuaOperationEvent(session, triggerStart, "controlChanged", swapped);
  setOperatedUids(hostState, swapped);
  lua.lua_pushboolean(L, swapped.length > 0);
  return 1;
}

function pushChangePosition(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const uids = readCardOrGroupUids(L, 1);
  const firstPositionMask = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  if (firstPositionMask === undefined || !positionFromMask(firstPositionMask)) {
    setOperatedUids(hostState, []); lua.lua_pushinteger(L, 0); return 1;
  }
  const usesPositionOverload = lua.lua_isnumber(L, 3) || lua.lua_isnumber(L, 4) || lua.lua_isnumber(L, 5);
  const faceUpDefenseMask = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : undefined, faceDownDefenseMask = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : undefined;
  beginLuaOperationMoveStep(session, hostState);
  const triggerStart = session.state.pendingTriggers.length;
  const changed: string[] = [];
  for (const uid of uids) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid); if (!card) continue;
    const requestedPositionMask = !usesPositionOverload ? firstPositionMask : card.position === "faceUpDefense" ? faceUpDefenseMask : card.position === "faceDownDefense" ? faceDownDefenseMask : firstPositionMask;
    const requestedPosition = requestedPositionMask === undefined ? undefined : positionFromMask(requestedPositionMask);
    if (!requestedPosition || luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)) continue;
    if (changeSpellTrapPosition(session.state, card, requestedPosition, requestedPositionMask)) {
      changed.push(uid);
      continue;
    }
    try {
      changeDuelCardPosition(session.state, card.controller, uid, requestedPosition, "effect", luaEffectReasonPayload(hostState, duelReason.effect, hostState.activeContext?.player ?? card.controller));
      changed.push(uid);
    } catch {
      // EDOPro-style helpers report the number of changed cards; illegal changes simply fail.
    }
  }
  setOperatedUids(hostState, changed);
  finishLuaOperationMoveStep(hostState, changed.length > 0);
  regroupLuaOperationEvent(session, triggerStart, "positionChanged", changed, "monsterZone");
  lua.lua_pushinteger(L, changed.length);
  return 1;
}

function pushChangeToFaceupAttackOrFacedownDefense(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const uid = readCardUid(L, 1);
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  const nextPosition = card ? faceupAttackOrFacedownDefensePosition(card) : undefined;
  if (!uid || !card || !nextPosition || !canChangeDuelCardPosition(session.state, uid, nextPosition, "manual") || luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)) {
    setOperatedUids(hostState, []);
    return 0;
  }
  try {
    beginLuaOperationMoveStep(session, hostState);
    changeDuelCardPosition(session.state, card.controller, uid, nextPosition, "manual");
    setOperatedUids(hostState, [uid]);
    finishLuaOperationMoveStep(hostState, true);
  } catch {
    setOperatedUids(hostState, []);
  }
  return 0;
}

function pushMoveToField(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const uid = readCardUid(L, 1);
  const targetPlayer = readOptionalPlayer(L, 3);
  const destination = readFieldDestination(L, 4);
  const requestedPosition = lua.lua_isnumber(L, 5) ? positionFromMask(lua.lua_tointeger(L, 5)) : undefined;
  const zoneMask = lua.lua_isnumber(L, 7) ? lua.lua_tointeger(L, 7) : undefined;
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  const requestedSequence =
    targetPlayer !== undefined && destination && zoneMask !== undefined && zoneMask !== 0 ? firstFieldZoneMaskSequence(session, targetPlayer, destination, zoneMask, uid ?? "") : undefined;
  if (
    !uid ||
    !card ||
    targetPlayer === undefined ||
    !destination ||
    !hasOpenFieldZone(session, targetPlayer, destination, zoneMask, uid, requestedSequence) ||
    !canMoveToFieldDestination(session, card, destination, targetPlayer, requestedSequence) ||
    luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)
  ) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const before = movementSnapshot(card);
  const preservedSequences = requestedSequence === undefined ? undefined : fieldZoneSequenceSnapshot(session, targetPlayer, destination, uid);
  beginLuaOperationMoveStep(session, hostState);
  try {
    const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
    const moved = card.location === destination
      ? moveDuelCard(session.state, uid, destination, targetPlayer, duelReason.effect, reasonPlayer)
      : moveDuelCardWithRedirects(session.state, uid, destination, targetPlayer, duelReason.effect, reasonPlayer, luaEffectReasonPayload(hostState, duelReason.effect, reasonPlayer));
    if (requestedPosition) applyLuaMovePosition(moved, requestedPosition);
    applyFieldZoneSequence(session, moved, destination, requestedSequence, preservedSequences);
    assignReasonCard(moved, hostState);
    const changed = didMove(moved, before);
    if (changed && before.location === moved.location) collectLuaMoveEvent(session, "moved", moved);
    if (changed && before.controller !== moved.controller) {
      pushDuelLog(session.state, "control", targetPlayer, moved.name, `Moved to player ${targetPlayer}'s field`);
      collectLuaMoveEvent(session, "controlChanged", moved);
    }
    setOperatedUids(hostState, changed ? [uid] : []);
    finishLuaOperationMoveStep(hostState, changed);
    lua.lua_pushinteger(L, changed ? 1 : 0);
    return 1;
  } catch {
    setOperatedUids(hostState, []);
    finishLuaOperationMoveStep(hostState, false);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
}

function canMoveToFieldDestination(
  session: DuelSession,
  card: DuelCardInstance,
  destination: "monsterZone" | "spellTrapZone",
  targetPlayer: PlayerId,
  requestedSequence: number | undefined,
): boolean {
  if (card.location !== destination) return canMoveDuelCardToLocation(session.state, card.uid, destination, duelReason.effect);
  return card.controller !== targetPlayer || requestedSequence !== undefined && card.sequence !== requestedSequence;
}

function hasOpenFieldZone(
  session: DuelSession,
  player: PlayerId,
  destination: "monsterZone" | "spellTrapZone",
  zoneMask: number | undefined,
  movingUid: string,
  requestedSequence: number | undefined,
): boolean {
  if (destination === "monsterZone") return hasOpenMonsterZone(session, player, zoneMask);
  if (zoneMask !== undefined && zoneMask !== 0) return requestedSequence !== undefined;
  return hasZoneSpace(session.state, player, destination);
}

function fieldZoneSequenceSnapshot(session: DuelSession, player: PlayerId, destination: "monsterZone" | "spellTrapZone", movingUid: string): Map<string, number> {
  return new Map(
    session.state.cards
      .filter((card) => card.controller === player && card.location === destination && card.uid !== movingUid)
      .map((card) => [card.uid, card.sequence]),
  );
}

function applyFieldZoneSequence(
  session: DuelSession,
  card: DuelCardInstance,
  destination: "monsterZone" | "spellTrapZone",
  requestedSequence: number | undefined,
  preservedSequences: Map<string, number> | undefined,
): void {
  if (requestedSequence === undefined || !preservedSequences || card.location !== destination) return;
  for (const [uid, sequence] of preservedSequences) {
    const preserved = session.state.cards.find((candidate) => candidate.uid === uid);
    if (preserved) preserved.sequence = sequence;
  }
  card.sequence = requestedSequence;
}

function firstFieldZoneMaskSequence(session: DuelSession, player: PlayerId, destination: "monsterZone" | "spellTrapZone", zoneMask: number | undefined, movingUid: string): number | undefined {
  if (zoneMask === undefined || zoneMask === 0) return undefined;
  return firstOpenFieldZoneSequence(session.state, player, destination, [movingUid], zoneMask);
}

function pushActivateFieldSpell(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const uid = readCardUid(L, 1);
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  const activatingPlayer = readOptionalPlayer(L, 3) ?? card?.controller ?? session.state.turnPlayer;
  const targetPlayer = readOptionalPlayer(L, 10) ?? activatingPlayer;
  if (!uid || !card || !isFieldSpell(card) || !canMoveDuelCardToLocation(session.state, uid, "spellTrapZone", duelReason.rule)) {
    setOperatedUids(hostState, []);
    lua.lua_pushboolean(L, false);
    return 1;
  }

  beginLuaOperationMoveStep(session, hostState);
  const previousFieldSpell = activeFieldSpell(session.state, targetPlayer, uid);
  const sharedField = isDuelType(session.state, 0x400);
  const opponentFieldSpell = sharedField ? activeFieldSpell(session.state, otherPlayer(targetPlayer), uid) : undefined;
  for (const replacement of [previousFieldSpell, opponentFieldSpell]) {
    if (!replacement) continue;
    try {
      moveDuelCardWithRedirects(session.state, replacement.uid, "graveyard", replacement.controller, duelReason.rule, activatingPlayer);
    } catch {
      moveDuelCardWithRedirects(session.state, uid, "graveyard", card.controller, duelReason.rule, activatingPlayer);
      finishLuaOperationMoveStep(hostState, true);
      setOperatedUids(hostState, []);
      lua.lua_pushboolean(L, false);
      return 1;
    }
  }

  if (!hasZoneSpace(session.state, targetPlayer, "spellTrapZone")) {
    moveDuelCardWithRedirects(session.state, uid, "graveyard", card.controller, duelReason.rule, activatingPlayer);
    finishLuaOperationMoveStep(hostState, true);
    setOperatedUids(hostState, []);
    lua.lua_pushboolean(L, false);
    return 1;
  }

  const moved = moveDuelCardWithRedirects(session.state, uid, "spellTrapZone", targetPlayer, duelReason.rule, activatingPlayer, luaEffectReasonPayload(hostState, duelReason.rule, activatingPlayer));
  moved.position = "faceUpAttack";
  moved.faceUp = true;
  finishLuaOperationMoveStep(hostState, true);
  setOperatedUids(hostState, [uid]);
  lua.lua_pushboolean(L, true);
  return 1;
}

function pushReturnToField(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const uid = readCardUid(L, 1);
  const requestedPosition = lua.lua_isnumber(L, 2) ? positionFromMask(lua.lua_tointeger(L, 2)) : undefined;
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  const destination = card?.previousLocation === "monsterZone" || card?.previousLocation === "spellTrapZone" ? card.previousLocation : undefined;
  const controller = card?.previousController;
  const previousSequence = previousFieldSequence(card);
  if (
    !uid ||
    !card ||
    !destination ||
    controller === undefined ||
    !hasZoneSpace(session.state, controller, destination) ||
    !canMoveDuelCardToLocation(session.state, uid, destination, duelReason.effect) ||
    luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)
  ) {
    setOperatedUids(hostState, []);
    lua.lua_pushboolean(L, false);
    return 1;
  }
  const preservedSequences = previousSequence === undefined ? undefined : shiftedFieldZoneSequenceSnapshot(session, controller, destination, uid, previousSequence);
  beginLuaOperationMoveStep(session, hostState);
  try {
    const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
    const moved = moveDuelCardWithRedirects(session.state, uid, destination, controller, duelReason.effect, reasonPlayer, luaEffectReasonPayload(hostState, duelReason.effect, reasonPlayer));
    applyLuaMovePosition(moved, requestedPosition ?? card.previousPosition ?? moved.position);
    applyFieldZoneSequence(session, moved, destination, previousSequence, preservedSequences);
    finishLuaOperationMoveStep(hostState, true);
    setOperatedUids(hostState, [uid]);
    lua.lua_pushboolean(L, true);
    return 1;
  } catch {
    setOperatedUids(hostState, []);
    finishLuaOperationMoveStep(hostState, false);
    lua.lua_pushboolean(L, false);
    return 1;
  }
}

function previousFieldSequence(card: DuelCardInstance | undefined): number | undefined {
  const sequence = card?.previousSequence;
  return sequence !== undefined && sequence >= 0 && sequence < 5 ? sequence : undefined;
}

function shiftedFieldZoneSequenceSnapshot(session: DuelSession, player: PlayerId, destination: "monsterZone" | "spellTrapZone", movingUid: string, openedSequence: number): Map<string, number> {
  return new Map(
    session.state.cards
      .filter((card) => card.controller === player && card.location === destination && card.uid !== movingUid)
      .map((card) => [card.uid, card.sequence >= openedSequence ? card.sequence + 1 : card.sequence]),
  );
}

function pushReturnToGrave(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const moved: string[] = [];
  beginLuaOperationMoveStep(session, hostState);
  const triggerStart = session.state.pendingTriggers.length;
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card || card.location !== "banished" || !canMoveDuelCardToLocation(session.state, uid, "graveyard", duelReason.return)) continue;
    const before = movementSnapshot(card);
    try {
      const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
      const result = moveDuelCardWithRedirects(session.state, uid, "graveyard", card.controller, duelReason.return, reasonPlayer, luaEffectReasonPayload(hostState, duelReason.return, reasonPlayer));
      assignReasonCard(result, hostState);
      collectLuaMoveEvent(session, "returnedToGraveyard", result);
      if (didMove(result, before)) moved.push(uid);
    } catch {
      // Return-to-grave reports successful card moves only.
    }
  }
  finishLuaOperationMoveStep(hostState, moved.length > 0);
  regroupLuaOperationEvent(session, triggerStart, "moved", moved);
  regroupLuaOperationEvent(session, triggerStart, "returnedToGraveyard", moved, "graveyard");
  setOperatedUids(hostState, moved);
  lua.lua_pushinteger(L, moved.length);
  return 1;
}

function pushMoveToDeckBottom(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  if (session.state.status === "ended") {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const moved = lua.lua_isnumber(L, 1) ? moveDecktopCardsToBottom(L, session) : moveCardsToDeckBottom(L, session, hostState);
  setOperatedUids(hostState, moved);
  lua.lua_pushinteger(L, moved.length);
  return 1;
}

function pushMoveToDeckTop(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  if (session.state.status === "ended") {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const moved = lua.lua_isnumber(L, 1) ? moveDecktopCardsToTop(L, session) : moveCardsToDeckTop(L, session, hostState);
  setOperatedUids(hostState, moved);
  lua.lua_pushinteger(L, moved.length);
  return 1;
}

function moveDecktopCardsToBottom(L: unknown, session: DuelSession): string[] {
  const count = Math.max(0, lua.lua_tointeger(L, 1));
  const player = readOptionalPlayer(L, 2) ?? session.state.turnPlayer;
  const moved: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const card = getCards(session.state, player, "deck")[0];
    if (!card) break;
    moveDeckCardToBottom(session.state, card);
    moved.push(card.uid);
  }
  return moved;
}

function moveDecktopCardsToTop(L: unknown, session: DuelSession): string[] {
  const count = Math.max(0, lua.lua_tointeger(L, 1));
  const player = readOptionalPlayer(L, 2) ?? session.state.turnPlayer;
  return getCards(session.state, player, "deck").slice(0, count).map((card) => card.uid);
}

function moveCardsToDeckBottom(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): string[] {
  const targetPlayer = readOptionalPlayer(L, 2);
  const reason = readMoveReason(L, 3, 0);
  const moved: string[] = [];
  const eventMoved: string[] = [];
  beginLuaOperationMoveStep(session, hostState);
  const triggerStart = session.state.pendingTriggers.length;
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    if (card.location === "deck") {
      moveDeckCardToBottom(session.state, card);
      moved.push(uid);
      continue;
    }
    if (luaMoveBlockedByImmunity(L, session, hostState, card, reason)) continue;
    if (!canMoveDuelCardToLocation(session.state, uid, "deck", reason)) continue;
    const before = movementSnapshot(card);
    try {
      const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
      const result = moveDuelCardWithRedirects(session.state, uid, "deck", targetPlayer ?? card.controller, reason, reasonPlayer, luaEffectReasonPayload(hostState, reason ?? 0, reasonPlayer));
      if (didMove(result, before)) {
        moved.push(uid);
        eventMoved.push(uid);
      }
    } catch {
      // EDOPro-style helpers report successful movements only.
    }
  }
  finishLuaOperationMoveStep(hostState, moved.length > 0);
  regroupGenericDestinationEvents(session, triggerStart, eventMoved);
  return moved;
}

function moveCardsToDeckTop(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): string[] {
  const targetPlayer = readOptionalPlayer(L, 2);
  const reason = readMoveReason(L, 3, 0);
  const moved: string[] = [];
  const eventMoved: string[] = [];
  beginLuaOperationMoveStep(session, hostState);
  const triggerStart = session.state.pendingTriggers.length;
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    if (card.location === "deck") {
      moveDeckCardToTop(session.state, card);
      moved.push(uid);
      continue;
    }
    if (luaMoveBlockedByImmunity(L, session, hostState, card, reason)) continue;
    if (!canMoveDuelCardToLocation(session.state, uid, "deck", reason)) continue;
    const before = movementSnapshot(card);
    try {
      const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
      const result = moveDuelCardWithRedirects(session.state, uid, "deck", targetPlayer ?? card.controller, reason, reasonPlayer, luaEffectReasonPayload(hostState, reason ?? 0, reasonPlayer));
      if (didMove(result, before)) {
        moveDeckCardToTop(session.state, result);
        moved.push(uid);
        eventMoved.push(uid);
      }
    } catch {
      // EDOPro-style helpers report successful movements only.
    }
  }
  finishLuaOperationMoveStep(hostState, moved.length > 0);
  regroupGenericDestinationEvents(session, triggerStart, eventMoved);
  return moved;
}

function pushSwapSequence(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const firstUid = readCardUid(L, 1);
  const secondUid = readCardUid(L, 2);
  const first = firstUid ? session.state.cards.find((candidate) => candidate.uid === firstUid) : undefined;
  const second = secondUid ? session.state.cards.find((candidate) => candidate.uid === secondUid) : undefined;
  const pair = swappableSequencePair(first, second);
  if (!pair) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const [left, right] = pair;
  if (luaMoveBlockedByImmunity(L, session, hostState, left, duelReason.effect) || luaMoveBlockedByImmunity(L, session, hostState, right, duelReason.effect)) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const firstSequence = left.sequence;
  left.sequence = right.sequence;
  right.sequence = firstSequence;
  setOperatedUids(hostState, [left.uid, right.uid]);
  lua.lua_pushinteger(L, 1);
  return 1;
}

function pushMoveSequence(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const uid = readCardUid(L, 1);
  const sequence = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : undefined;
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  if (!card || sequence === undefined || !canReorderFieldZone(card.location)) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  if (luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const location = card.location === "monsterZone" || card.location === "spellTrapZone" ? card.location : undefined;
  if (!location || sequence < 0 || sequence >= 5 || card.sequence === sequence || isFieldZoneDisabled(session.state, card.controller, location, sequence)) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const cards = getCards(session.state, card.controller, location);
  if (!cards.some((candidate) => candidate.uid !== card.uid && candidate.sequence === sequence)) {
    card.sequence = sequence;
    setOperatedUids(hostState, [card.uid]);
    lua.lua_pushinteger(L, 1);
    return 1;
  }
  if (sequence >= cards.length) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const ordered = cards.filter((candidate) => candidate.uid !== card.uid);
  ordered.splice(sequence, 0, card);
  for (const [nextSequence, candidate] of ordered.entries()) candidate.sequence = nextSequence;
  setOperatedUids(hostState, [card.uid]);
  lua.lua_pushinteger(L, 1);
  return 1;
}

function pushShuffleSetCard(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const shuffled: string[] = [];
  const requested = new Set(readCardOrGroupUids(L, 1));
  for (const bucket of shuffleBuckets(session.state, requested)) {
    const next = shuffleLuaMoveCards(session, bucket.cards);
    for (const [index, card] of next.entries()) card.sequence = bucket.sequences[index] ?? card.sequence;
    shuffled.push(...next.map((card) => card.uid));
  }
  setOperatedUids(hostState, shuffled);
  return 0;
}

function shuffleBuckets(state: DuelState, requested: Set<string>): { cards: DuelCardInstance[]; sequences: number[] }[] {
  const keys = new Set<string>();
  for (const uid of requested) {
    const card = state.cards.find((candidate) => candidate.uid === uid);
    if (card && canReorderFieldZone(card.location)) keys.add(`${card.controller}:${card.location}`);
  }
  return [...keys]
    .map((key) => {
      const [player, location] = key.split(":") as [string, DuelLocation];
      const cards = getCards(state, Number(player) === 1 ? 1 : 0, location).filter((card) => requested.has(card.uid));
      return { cards, sequences: cards.map((card) => card.sequence).sort((left, right) => left - right) };
    })
    .filter((bucket) => bucket.cards.length > 0);
}

function moveCardOrGroup(session: DuelSession, L: unknown, hostState: LuaDuelMoveApiHostState, mover: LuaCardMover, extraReason = 0, groupedEventName?: DuelEventName, groupedLocation?: DuelLocation): string[] {
  if (session.state.status === "ended") return [];
  const releasePlayerReasonOverload = extraReason === duelReason.release && lua.lua_isnumber(L, 3);
  const reason = readMoveReason(L, releasePlayerReasonOverload ? 3 : 2, extraReason), reasonPlayer = readOptionalPlayer(L, releasePlayerReasonOverload ? 2 : 4) ?? hostState.activeContext?.player ?? session.state.turnPlayer;
  const moved: string[] = [];
  beginLuaOperationMoveStep(session, hostState);
  const triggerStart = session.state.pendingTriggers.length;
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    if (luaMoveBlockedByImmunity(L, session, hostState, card, reason)) continue;
    const before = movementSnapshot(card);
    try {
      const result = mover(session.state, uid, card.controller, reason, reasonPlayer, luaEffectReasonPayload(hostState, reason ?? 0, reasonPlayer));
      assignReasonCard(result, hostState);
      if (didMove(result, before)) moved.push(uid);
    } catch {
      // EDOPro-style helpers report the number of moved cards; illegal moves simply fail.
    }
  }
  finishLuaOperationMoveStep(hostState, moved.length > 0);
  regroupLuaOperationEvent(session, triggerStart, "moved", moved);
  regroupLuaOperationEvent(session, triggerStart, "leftField", moved.filter((uid) => session.state.cards.some((card) => card.uid === uid && (card.previousLocation === "monsterZone" || card.previousLocation === "spellTrapZone") && card.location !== "monsterZone" && card.location !== "spellTrapZone")));
  if (groupedEventName === "destroyed") regroupLuaOperationEvent(session, triggerStart, "destroying", moved);
  if (groupedEventName) regroupLuaOperationEvent(session, triggerStart, groupedEventName, moved, groupedLocation);
  return moved;
}

function moveCardOrGroupToLocation(session: DuelSession, L: unknown, hostState: LuaDuelMoveApiHostState, location: DuelLocation, reasonIndex: number): string[] {
  if (session.state.status === "ended") return [];
  const reason = readMoveReason(L, reasonIndex, 0);
  const deckSequence = location === "deck" && lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : undefined;
  const reasonPlayer = readOptionalPlayer(L, reasonIndex + 1) ?? hostState.activeContext?.player ?? session.state.turnPlayer;
  const moved: string[] = [];
  beginLuaOperationMoveStep(session, hostState);
  const triggerStart = session.state.pendingTriggers.length;
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    const destination = sendToDeckDestination(card, location);
    if (!canMoveDuelCardToLocation(session.state, uid, destination, reason) || luaMoveBlockedByImmunity(L, session, hostState, card, reason)) continue;
    const before = movementSnapshot(card);
    try {
      const result = moveDuelCardWithRedirects(session.state, uid, destination, readOptionalPlayer(L, 2) ?? card.controller, reason, reasonPlayer, luaEffectReasonPayload(hostState, reason ?? 0, reasonPlayer));
      assignReasonCard(result, hostState);
      if (didMove(result, before)) {
        applyDeckSequence(session, result, deckSequence);
        moved.push(uid);
      }
    } catch {
      // Redirected destination restrictions fail like other EDOPro-style move helpers.
    }
  }
  if (location === "deck" && deckSequence === 2 && moved.length > 0) shuffleMovedDecks(session, moved);
  finishLuaOperationMoveStep(hostState, moved.length > 0);
  regroupLuaOperationEvent(session, triggerStart, "moved", moved);
  regroupLuaOperationEvent(session, triggerStart, "leftField", moved.filter((uid) => session.state.cards.some((card) => card.uid === uid && (card.previousLocation === "monsterZone" || card.previousLocation === "spellTrapZone") && card.location !== "monsterZone" && card.location !== "spellTrapZone")));
  regroupLuaOperationEvent(session, triggerStart, "leftGraveyard", moved.filter((uid) => session.state.cards.some((card) => card.uid === uid && card.previousLocation === "graveyard")));
  if (location === "hand") regroupLuaOperationEvent(session, triggerStart, "sentToHand", moved, "hand");
  else if (location === "deck") {
    regroupLuaOperationEvent(session, triggerStart, "sentToDeck", moved, "deck");
    regroupLuaOperationEvent(session, triggerStart, "sentToDeck", moved, "extraDeck");
  } else if (location === "extraDeck") regroupLuaOperationEvent(session, triggerStart, "sentToDeck", moved, "extraDeck");
  return moved;
}

function sendToDeckDestination(card: DuelCardInstance, requested: DuelLocation): DuelLocation {
  return requested === "deck" && card.kind === "extra" ? "extraDeck" : requested;
}

function regroupGenericDestinationEvents(session: DuelSession, triggerStart: number, moved: string[]): void {
  regroupLuaOperationEvent(session, triggerStart, "moved", moved);
  regroupLuaOperationEvent(session, triggerStart, "leftField", moved.filter((uid) => session.state.cards.some((card) => card.uid === uid && (card.previousLocation === "monsterZone" || card.previousLocation === "spellTrapZone") && card.location !== "monsterZone" && card.location !== "spellTrapZone")));
  regroupLuaOperationEvent(session, triggerStart, "leftGraveyard", moved.filter((uid) => session.state.cards.some((card) => card.uid === uid && card.previousLocation === "graveyard")));
  regroupLuaOperationEvent(session, triggerStart, "sentToGraveyard", moved, "graveyard");
  regroupLuaOperationEvent(session, triggerStart, "banished", moved, "banished");
  regroupLuaOperationEvent(session, triggerStart, "sentToHand", moved, "hand");
  regroupLuaOperationEvent(session, triggerStart, "sentToDeck", moved, "deck");
  regroupLuaOperationEvent(session, triggerStart, "sentToDeck", moved, "extraDeck");
}

function applyDeckSequence(session: DuelSession, card: DuelCardInstance, deckSequence: number | undefined): void {
  if (card.location !== "deck") return;
  if (deckSequence === 0) moveDeckCardToTop(session.state, card);
  else if (deckSequence === 1) moveDeckCardToBottom(session.state, card);
}

function shuffleMovedDecks(session: DuelSession, movedUids: string[]): void {
  const keys = new Set<string>();
  for (const uid of movedUids) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (card?.location === "deck") keys.add(`${card.controller}:deck`);
  }
  for (const key of keys) {
    const player = key.startsWith("1:") ? 1 : 0;
    const shuffled = shuffleLuaMoveCards(session, getCards(session.state, player, "deck"));
    for (const [sequence, card] of shuffled.entries()) card.sequence = sequence;
  }
}
export function markLuaOperationTimingBoundary(session: DuelSession, hostState: LuaOperationTimingBoundaryHostState): void {
  const start = hostState.activeOperationTriggerStart;
  if (!hostState.activeContext || start === undefined || !hostState.activeOperationMoved) return;
  session.state.pendingTriggers = session.state.pendingTriggers.filter((trigger, index) => {
    if (index < start) return true;
    const effect = session.state.effects.find((candidate) => candidate.id === trigger.effectId && candidate.sourceUid === trigger.sourceUid);
    return effect?.optional === false || effect?.triggerTiming !== "when";
  });
  setWaitingForPendingTriggerBucket(session.state);
}

function beginLuaOperationMoveStep(session: DuelSession, hostState: LuaDuelMoveApiHostState): void { markLuaOperationTimingBoundary(session, hostState); }

function finishLuaOperationMoveStep(hostState: LuaDuelMoveApiHostState, moved: boolean): void {
  if (hostState.activeContext && moved) hostState.activeOperationMoved = true;
}

function collectLuaMoveEvent(session: DuelSession, eventName: DuelEventName, eventCard?: DuelCardInstance): void {
  const payload: DuelEventPayload = eventCardReasonPayload(eventCard);
  collectDuelTriggerEffects(session.state, eventName, eventCard, payload);
}

export function regroupLuaOperationEvent(session: DuelSession, triggerStart: number, eventName: DuelEventName, eventUids: string[], eventLocation?: DuelLocation): void {
  const uniqueEventUids = [...new Set(eventUids)];
  if (uniqueEventUids.length <= 1) return;
  const eventCards = uniqueEventUids.map((uid) => session.state.cards.find((card) => card.uid === uid && (eventLocation === undefined || card.location === eventLocation))).filter((card): card is DuelCardInstance => Boolean(card));
  if (eventCards.length <= 1) return;
  const uidSet = new Set(eventCards.map((card) => card.uid));
  session.state.pendingTriggers = session.state.pendingTriggers.filter((trigger, index) => index < triggerStart || trigger.eventName !== eventName || !trigger.eventCardUid || !uidSet.has(trigger.eventCardUid));
  collectDuelGroupedTriggerEffects(session.state, eventName, eventCards, { eventUids: eventCards.map((card) => card.uid) });
}

function specialSummonExplicitExtraDeckCard(
  session: DuelSession,
  card: DuelCardInstance,
  player: PlayerId,
  summonType: number,
  reasonPlayer: PlayerId,
  payload: DuelEventPayload,
  requestedPosition: CardPosition | undefined,
  zoneMask: number | undefined,
  hostState: LuaDuelMoveApiHostState,
  collectSuccess = true,
): DuelCardInstance | undefined {
  if (card.location !== "extraDeck" || !hasOpenMonsterZone(session, player, zoneMask) || !canPlayerSpecialSummon(session.state, player, card, summonType, hostState.activeLuaEffectId, requestedPosition)) return undefined;
  try {
    collectDuelTriggerEffects(session.state, "specialSummoning", card, payload);
    const existingMonsterSequences = zoneMask === undefined ? [] : monsterZoneSequenceSnapshot(session, player, card.uid);
    moveDuelCard(session.state, card.uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon, reasonPlayer);
    restoreMonsterZoneSequenceSnapshot(session, existingMonsterSequences);
    if (payload.eventReasonCardUid !== undefined) card.reasonCardUid = payload.eventReasonCardUid;
    if (payload.eventReasonEffectId !== undefined) card.reasonEffectId = payload.eventReasonEffectId;
    applyLuaMovePosition(card, requestedPosition ?? "faceUpAttack");
    applyMonsterZoneMask(session, card, player, zoneMask);
    card.summonType = duelSummonTypeFromCode(summonType);
    card.summonTypeCode = summonType;
    card.summonLocation = card.previousLocation;
    card.summonPlayer = player;
    card.summonPhase = session.state.phase;
    card.summonMaterialUids = card.summonMaterialUids ?? [];
    recordSpecialSummonActivity(session.state, player, card);
    pushDuelLog(session.state, "specialSummon", player, card.name, "Special Summoned");
    if (collectSuccess) collectDuelTriggerEffects(session.state, "specialSummoned", card);
    return card;
  } catch {
    return undefined;
  }
}

function assignReasonCard(card: DuelCardInstance, hostState: LuaDuelMoveApiHostState): void {
  if (hostState.activeContext?.source) card.reasonCardUid = hostState.activeContext.source.uid;
  const effectId = Number(hostState.activeContext?.chainLink?.effectId.match(/^lua-(\d+)/)?.[1]);
  if (Number.isFinite(effectId)) card.reasonEffectId = effectId;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function swappableSequencePair(first: DuelCardInstance | undefined, second: DuelCardInstance | undefined): [DuelCardInstance, DuelCardInstance] | undefined {
  if (!first || !second || first.uid === second.uid) return undefined;
  if (first.controller !== second.controller || first.location !== second.location) return undefined;
  return first.location === "monsterZone" || first.location === "spellTrapZone" ? [first, second] : undefined;
}

function canReorderFieldZone(location: DuelLocation): boolean {
  return location === "monsterZone" || location === "spellTrapZone";
}

function setOperatedUids(hostState: LuaDuelMoveApiHostState, uids: string[]): void {
  hostState.operatedUids.splice(0, hostState.operatedUids.length, ...uids);
}
