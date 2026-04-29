import fengari from "fengari";
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
import type { CardPosition, DuelCardInstance, DuelLocation, DuelSession, DuelState, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

type LuaCardMover = (state: DuelState, uid: string, controller?: PlayerId, reason?: number) => DuelCardInstance;

export interface LuaDuelMoveApiHostState {
  operatedUids: string[];
}

export function installDuelMoveApi(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): void {
  pushMoveHelper(L, "SendtoGrave", session, hostState, (state, uid, controller, reason) => sendDuelCardToGraveyard(state, uid, controller, reason));
  pushMoveHelper(L, "Destroy", session, hostState, (state, uid, controller, reason) => destroyDuelCard(state, uid, controller, reason), duelReason.destroy);
  pushMoveHelper(L, "Remove", session, hostState, (state, uid, controller, reason) => banishDuelCard(state, uid, controller, reason));
  pushMoveHelper(L, "Release", session, hostState, (state, uid, controller, reason) => sendDuelCardToGraveyard(state, uid, controller, reason), duelReason.release);
  pushMoveToLocationHelper(L, "SendtoHand", session, hostState, "hand", 3);
  pushMoveToLocationHelper(L, "SendtoDeck", session, hostState, "deck", 4);
  pushMoveToLocationHelper(L, "SendtoExtraP", session, hostState, "extraDeck", 3);
  pushMoveToLocationHelper(L, "SendtoExtra", session, hostState, "extraDeck", 3);
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveOverlayCard(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RemoveOverlayCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSpecialSummon(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SpecialSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushChangePosition(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ChangePosition"));
}

function pushMoveHelper(L: unknown, fieldName: string, session: DuelSession, hostState: LuaDuelMoveApiHostState, mover: LuaCardMover, extraReason = 0): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const moved = moveCardOrGroup(session, state, mover, extraReason);
    setOperatedUids(hostState, moved);
    lua.lua_pushinteger(state, moved.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushMoveToLocationHelper(L: unknown, fieldName: string, session: DuelSession, hostState: LuaDuelMoveApiHostState, location: DuelLocation, reasonIndex: number): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const moved = moveCardOrGroupToLocation(session, state, location, reasonIndex);
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

function moveCardOrGroup(session: DuelSession, L: unknown, mover: LuaCardMover, extraReason = 0): string[] {
  const reason = readMoveReason(L, 2, extraReason);
  const moved: string[] = [];
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    try {
      mover(session.state, uid, card.controller, reason);
      moved.push(uid);
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

function moveCardOrGroupToLocation(session: DuelSession, L: unknown, location: DuelLocation, reasonIndex: number): string[] {
  const reason = readMoveReason(L, reasonIndex, 0);
  const moved: string[] = [];
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card || !canMoveDuelCardToLocation(session.state, uid, location)) continue;
    moveDuelCardWithRedirects(session.state, uid, location, readOptionalPlayer(L, 2) ?? card.controller, reason);
    moved.push(uid);
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

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function setOperatedUids(hostState: LuaDuelMoveApiHostState, uids: string[]): void {
  hostState.operatedUids.splice(0, hostState.operatedUids.length, ...uids);
}
