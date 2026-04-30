import fengari from "fengari";
import { getCards, hasZoneSpace, pushDuelLog, resequence } from "#duel/card-state.js";
import {
  banishDuelCard,
  canMoveDuelCardToLocation,
  changeDuelCardPosition,
  detachDuelOverlayMaterials,
  destroyDuelCard,
  moveDuelCard,
  moveDuelCardWithRedirects,
  sendDuelCardToGraveyard,
  specialSummonDuelCard,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { locationsFromMask, positionFromMask, readCardUid, readGroupUids } from "#lua/api-utils.js";
import type { CardPosition, DuelCardInstance, DuelEffectContext, DuelLocation, DuelSession, DuelState, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

type LuaCardMover = (state: DuelState, uid: string, controller?: PlayerId, reason?: number, reasonPlayer?: PlayerId) => DuelCardInstance;

export interface LuaDuelMoveApiHostState {
  operatedUids: string[];
  activeContext?: DuelEffectContext | undefined;
}

export function installDuelMoveApi(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): void {
  pushMoveHelper(L, "SendtoGrave", session, hostState, (state, uid, controller, reason, reasonPlayer) => sendDuelCardToGraveyard(state, uid, controller, reason, reasonPlayer));
  pushMoveHelper(L, "Destroy", session, hostState, (state, uid, controller, reason, reasonPlayer) => destroyDuelCard(state, uid, controller, reason, reasonPlayer), duelReason.destroy);
  pushMoveHelper(L, "Remove", session, hostState, (state, uid, controller, reason, reasonPlayer) => banishDuelCard(state, uid, controller, reason, reasonPlayer));
  pushMoveHelper(L, "Release", session, hostState, (state, uid, controller, reason, reasonPlayer) => sendDuelCardToGraveyard(state, uid, controller, reason, reasonPlayer), duelReason.release);
  pushMoveToLocationHelper(L, "SendtoHand", session, hostState, "hand", 3);
  pushMoveToLocationHelper(L, "SendtoDeck", session, hostState, "deck", 4);
  pushMoveToLocationHelper(L, "SendtoExtraP", session, hostState, "extraDeck", 3);
  pushMoveToLocationHelper(L, "SendtoExtra", session, hostState, "extraDeck", 3);
  lua.lua_pushcfunction(L, (state: unknown) => pushOverlay(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("Overlay"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveOverlayCard(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RemoveOverlayCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSpecialSummon(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SpecialSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushEquip(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("Equip"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetControl(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GetControl"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChangePosition(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ChangePosition"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMoveToField(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("MoveToField"));
  lua.lua_pushcfunction(L, (state: unknown) => pushReturnToField(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ReturnToField"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSwapSequence(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SwapSequence"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMoveSequence(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("MoveSequence"));
}

function pushMoveHelper(L: unknown, fieldName: string, session: DuelSession, hostState: LuaDuelMoveApiHostState, mover: LuaCardMover, extraReason = 0): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const moved = moveCardOrGroup(session, state, hostState, mover, extraReason);
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

function pushSpecialSummon(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const uids = readCardOrGroupUids(L, 1);
  const targetPlayer = readOptionalPlayer(L, 4);
  const requestedPosition = lua.lua_isnumber(L, 7) ? positionFromMask(lua.lua_tointeger(L, 7)) : undefined;
  const moved: string[] = [];
  for (const uid of uids) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    try {
      const summoned = specialSummonDuelCard(session.state, uid, targetPlayer ?? card.controller);
      if (requestedPosition) applySummonPosition(summoned, requestedPosition);
      moved.push(uid);
    } catch {
      // EDOPro-style helpers report the number of moved cards; illegal moves simply fail.
    }
  }
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
  if (!equipUid || !equipCard || !target || target.location !== "monsterZone" || !hasZoneSpace(session.state, player, "spellTrapZone")) {
    setOperatedUids(hostState, []);
    lua.lua_pushboolean(L, false);
    return 1;
  }
  try {
    moveDuelCard(session.state, equipUid, "spellTrapZone", player, duelReason.effect, hostState.activeContext?.player ?? player);
    equipCard.equippedToUid = target.uid;
    equipCard.position = "faceUpAttack";
    equipCard.faceUp = true;
    pushDuelLog(session.state, "equip", player, equipCard.name, `Equipped to ${target.name}`);
    setOperatedUids(hostState, [equipUid]);
    lua.lua_pushboolean(L, true);
    return 1;
  } catch {
    setOperatedUids(hostState, []);
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
  const allowedLocations = lua.lua_isnumber(L, 5) ? locationsFromMask(lua.lua_tointeger(L, 5)) : undefined;
  const controlled: string[] = [];
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card || card.controller === targetPlayer || !canChangeControl(card, allowedLocations)) continue;
    if (!hasZoneSpace(session.state, targetPlayer, card.location)) continue;
    const previousController = card.controller;
    try {
      moveDuelCard(session.state, uid, card.location, targetPlayer, duelReason.effect, hostState.activeContext?.player ?? session.state.turnPlayer);
      resequence(session.state, previousController, card.location);
      pushDuelLog(session.state, "control", targetPlayer, card.name, `Took control from player ${previousController}`);
      controlled.push(uid);
    } catch {
      // EDOPro-style helpers report successful control changes only.
    }
  }
  setOperatedUids(hostState, controlled);
  lua.lua_pushinteger(L, controlled.length);
  return 1;
}

function pushChangePosition(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const uids = readCardOrGroupUids(L, 1);
  const requestedPosition = lua.lua_isnumber(L, 2) ? positionFromMask(lua.lua_tointeger(L, 2)) : undefined;
  if (!requestedPosition) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const changed: string[] = [];
  for (const uid of uids) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    try {
      changeDuelCardPosition(session.state, card.controller, uid, requestedPosition);
      changed.push(uid);
    } catch {
      // EDOPro-style helpers report the number of changed cards; illegal changes simply fail.
    }
  }
  setOperatedUids(hostState, changed);
  lua.lua_pushinteger(L, changed.length);
  return 1;
}

function pushMoveToField(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const uid = readCardUid(L, 1);
  const targetPlayer = readOptionalPlayer(L, 3);
  const destination = readFieldDestination(L, 4);
  const requestedPosition = lua.lua_isnumber(L, 5) ? positionFromMask(lua.lua_tointeger(L, 5)) : undefined;
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  if (!uid || !card || targetPlayer === undefined || !destination || !hasZoneSpace(session.state, targetPlayer, destination) || !canMoveDuelCardToLocation(session.state, uid, destination, duelReason.effect)) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const before = movementSnapshot(card);
  try {
    const moved = moveDuelCardWithRedirects(session.state, uid, destination, targetPlayer, duelReason.effect, hostState.activeContext?.player ?? session.state.turnPlayer);
    if (requestedPosition) applySummonPosition(moved, requestedPosition);
    setOperatedUids(hostState, didMove(moved, before) ? [uid] : []);
    lua.lua_pushinteger(L, didMove(moved, before) ? 1 : 0);
    return 1;
  } catch {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
}

function pushReturnToField(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const uid = readCardUid(L, 1);
  const requestedPosition = lua.lua_isnumber(L, 2) ? positionFromMask(lua.lua_tointeger(L, 2)) : undefined;
  const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  const destination = card?.previousLocation === "monsterZone" || card?.previousLocation === "spellTrapZone" ? card.previousLocation : undefined;
  const controller = card?.previousController;
  if (!uid || !card || !destination || controller === undefined || !hasZoneSpace(session.state, controller, destination) || !canMoveDuelCardToLocation(session.state, uid, destination, duelReason.effect)) {
    setOperatedUids(hostState, []);
    lua.lua_pushboolean(L, false);
    return 1;
  }
  try {
    const moved = moveDuelCardWithRedirects(session.state, uid, destination, controller, duelReason.effect, hostState.activeContext?.player ?? session.state.turnPlayer);
    applySummonPosition(moved, requestedPosition ?? card.previousPosition ?? moved.position);
    setOperatedUids(hostState, [uid]);
    lua.lua_pushboolean(L, true);
    return 1;
  } catch {
    setOperatedUids(hostState, []);
    lua.lua_pushboolean(L, false);
    return 1;
  }
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
  const cards = getCards(session.state, card.controller, card.location);
  if (sequence < 0 || sequence >= cards.length || card.sequence === sequence) {
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

function pushOverlay(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const targetUid = readCardUid(L, 1);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (!target || target.location !== "monsterZone") {
    setOperatedUids(hostState, []);
    return 0;
  }

  const moved: string[] = [];
  for (const uid of readCardOrGroupUids(L, 2)) {
    if (uid === target.uid || target.overlayUids.includes(uid)) continue;
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card || !canMoveDuelCardToLocation(session.state, uid, "overlay", duelReason.effect)) continue;
    try {
      removeOverlayReference(session.state, uid);
      moveDuelCard(session.state, uid, "overlay", target.controller, duelReason.effect, hostState.activeContext?.player ?? session.state.turnPlayer);
      target.overlayUids.push(uid);
      moved.push(uid);
    } catch {
      // EDOPro-style helpers expose successful moves through GetOperatedGroup.
    }
  }

  setOperatedUids(hostState, moved);
  if (moved.length > 0) pushDuelLog(session.state, "overlay", target.controller, target.name, `Attached ${moved.length} material(s)`);
  return 0;
}

function pushRemoveOverlayCard(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  const player = readOptionalPlayer(L, 1) ?? session.state.turnPlayer;
  const selfLocations = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const opponentLocations = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  const min = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 1;
  const max = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : min;
  const reason = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : duelReason.cost;
  const holders = overlayHolders(session, player, selfLocations, opponentLocations);
  const detached = detachOverlayRange(session, holders, min, max, player, reason);
  setOperatedUids(hostState, detached);
  lua.lua_pushinteger(L, detached.length);
  return 1;
}

function moveCardOrGroup(session: DuelSession, L: unknown, hostState: LuaDuelMoveApiHostState, mover: LuaCardMover, extraReason = 0): string[] {
  const reason = readMoveReason(L, 2, extraReason);
  const moved: string[] = [];
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    const before = movementSnapshot(card);
    try {
      const result = mover(session.state, uid, card.controller, reason, hostState.activeContext?.player ?? session.state.turnPlayer);
      if (didMove(result, before)) moved.push(uid);
    } catch {
      // EDOPro-style helpers report the number of moved cards; illegal moves simply fail.
    }
  }
  return moved;
}

function overlayHolders(session: DuelSession, player: PlayerId, selfMask: number, opponentMask: number): DuelCardInstance[] {
  return [
    ...overlayHoldersForPlayer(session, player, selfMask),
    ...overlayHoldersForPlayer(session, otherPlayer(player), opponentMask),
  ];
}

function overlayHoldersForPlayer(session: DuelSession, player: PlayerId, locationMask: number): DuelCardInstance[] {
  const locations = locationsFromMask(locationMask);
  if (locations.length === 0) return [];
  return session.state.cards.filter((card) => card.controller === player && locations.includes(card.location) && card.overlayUids.length > 0);
}

function detachOverlayRange(session: DuelSession, holders: DuelCardInstance[], min: number, max: number, player: PlayerId, reason: number): string[] {
  const available = holders.reduce((total, holder) => total + holder.overlayUids.length, 0);
  const count = Math.min(Math.max(min, 0), Math.max(max, 0), available);
  if (count < min) return [];
  const detached: string[] = [];
  let remaining = count;
  for (const holder of holders) {
    if (remaining <= 0) break;
    const holderCount = Math.min(holder.overlayUids.length, remaining);
    const materials = detachDuelOverlayMaterials(session.state, holder.uid, holderCount, player, reason);
    detached.push(...materials.map((material) => material.uid));
    remaining -= holderCount;
  }
  return detached;
}

function moveCardOrGroupToLocation(session: DuelSession, L: unknown, hostState: LuaDuelMoveApiHostState, location: DuelLocation, reasonIndex: number): string[] {
  const reason = readMoveReason(L, reasonIndex, 0);
  const moved: string[] = [];
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card || !canMoveDuelCardToLocation(session.state, uid, location, reason)) continue;
    const before = movementSnapshot(card);
    try {
      const result = moveDuelCardWithRedirects(session.state, uid, location, readOptionalPlayer(L, 2) ?? card.controller, reason, hostState.activeContext?.player ?? session.state.turnPlayer);
      if (didMove(result, before)) moved.push(uid);
    } catch {
      // Redirected destination restrictions fail like other EDOPro-style move helpers.
    }
  }
  return moved;
}

function readMoveReason(L: unknown, index: number, extraReason: number): number | undefined {
  const reason = lua.lua_isnumber(L, index) ? lua.lua_tointeger(L, index) : undefined;
  if (reason === undefined && extraReason === 0) return undefined;
  return (reason ?? 0) | extraReason;
}

function applySummonPosition(card: { position: CardPosition; faceUp: boolean }, position: CardPosition): void {
  card.position = position;
  card.faceUp = position !== "faceDownDefense";
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function readOptionalPlayer(L: unknown, index: number): PlayerId | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const value = lua.lua_tointeger(L, index);
  if (value !== 0 && value !== 1) return undefined;
  return value;
}

function readFieldDestination(L: unknown, index: number): "monsterZone" | "spellTrapZone" | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const locations = locationsFromMask(lua.lua_tointeger(L, index));
  if (locations.includes("monsterZone")) return "monsterZone";
  if (locations.includes("spellTrapZone")) return "spellTrapZone";
  return undefined;
}

function movementSnapshot(card: DuelCardInstance): Pick<DuelCardInstance, "controller" | "location" | "sequence"> {
  return { controller: card.controller, location: card.location, sequence: card.sequence };
}

function didMove(card: DuelCardInstance, before: Pick<DuelCardInstance, "controller" | "location" | "sequence">): boolean {
  return card.controller !== before.controller || card.location !== before.location || card.sequence !== before.sequence;
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

function canChangeControl(card: DuelCardInstance, allowedLocations: DuelLocation[] | undefined): boolean {
  if (card.location !== "monsterZone" && card.location !== "spellTrapZone") return false;
  return !allowedLocations || allowedLocations.includes(card.location);
}

function removeOverlayReference(state: DuelState, uid: string): void {
  for (const card of state.cards) {
    card.overlayUids = card.overlayUids.filter((materialUid) => materialUid !== uid);
  }
}

function setOperatedUids(hostState: LuaDuelMoveApiHostState, uids: string[]): void {
  hostState.operatedUids.splice(0, hostState.operatedUids.length, ...uids);
}
