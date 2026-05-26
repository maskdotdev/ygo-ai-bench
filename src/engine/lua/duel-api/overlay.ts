import fengari from "fengari";
import { pushDuelLog } from "#duel/card-state.js";
import { canMoveDuelCardToLocation, detachDuelOverlayMaterials, moveDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { locationsFromMask, readCardUid } from "#lua/api-utils.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { luaMoveBlockedByImmunity } from "#lua/duel-api/move-immunity.js";
import { readCardOrGroupUids, readOptionalPlayer } from "#lua/duel-api/move-readers.js";
import type { DuelCardInstance, DuelLocation, DuelSession, DuelState, PlayerId } from "#duel/types.js";
import { markLuaOperationTimingBoundary, regroupLuaOperationEvent, type LuaDuelMoveApiHostState } from "#lua/duel-api/move.js";
import type { DuelEventPayload } from "#duel/event-history.js";

const { lua, to_luastring } = fengari;

export function installDuelOverlayApi(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushOverlay(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("Overlay"));
  lua.lua_pushcfunction(L, (state: unknown) => pushRemoveOverlayCard(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("RemoveOverlayCard"));
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckRemoveOverlayCard(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckRemoveOverlayCard"));
}

export function removeOverlayReference(state: DuelState, uid: string): void {
  for (const card of state.cards) {
    card.overlayUids = card.overlayUids.filter((materialUid) => materialUid !== uid);
  }
}

function pushOverlay(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  if (session.state.status === "ended") {
    setOperatedUids(hostState, []);
    return 0;
  }
  const targetUid = readCardUid(L, 1);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (!target || (target.location !== "monsterZone" && target.location !== "extraDeck")) {
    setOperatedUids(hostState, []);
    return 0;
  }

  const moved: string[] = [];
  const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
  const payload = luaEffectReasonPayload(hostState, duelReason.effect, reasonPlayer);
  for (const uid of readCardOrGroupUids(L, 2)) {
    if (uid === target.uid || target.overlayUids.includes(uid)) continue;
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    const reassigningOverlayMaterial = card?.location === "overlay";
    if (!card || (!reassigningOverlayMaterial && !canMoveDuelCardToLocation(session.state, uid, "overlay", duelReason.effect)) || luaMoveBlockedByImmunity(L, session, hostState, card, duelReason.effect)) continue;
    try {
      const attachedUids = [...card.overlayUids];
      removeOverlayReference(session.state, uid);
      if (reassigningOverlayMaterial) {
        card.controller = target.controller;
        card.reason = duelReason.effect;
        card.reasonPlayer = reasonPlayer;
      } else {
        moveDuelCard(session.state, uid, "overlay", target.controller, duelReason.effect, reasonPlayer);
      }
      applyReasonPayload(card, payload);
      card.overlayUids = [];
      card.sequence = target.overlayUids.length;
      target.overlayUids.push(uid);
      moved.push(uid);
      for (const attachedUid of attachedUids) {
        if (target.overlayUids.includes(attachedUid)) continue;
        const attached = session.state.cards.find((candidate) => candidate.uid === attachedUid);
        if (!attached || luaMoveBlockedByImmunity(L, session, hostState, attached, duelReason.effect)) continue;
        removeOverlayReference(session.state, attachedUid);
        if (attached.location === "overlay") {
          attached.controller = target.controller;
          attached.reason = duelReason.effect;
          attached.reasonPlayer = reasonPlayer;
        } else if (canMoveDuelCardToLocation(session.state, attachedUid, "overlay", duelReason.effect)) {
          moveDuelCard(session.state, attachedUid, "overlay", target.controller, duelReason.effect, reasonPlayer);
        } else {
          continue;
        }
        applyReasonPayload(attached, payload);
        attached.sequence = target.overlayUids.length;
        target.overlayUids.push(attachedUid);
        moved.push(attachedUid);
      }
    } catch {
      // EDOPro-style helpers expose successful moves through GetOperatedGroup.
    }
  }

  setOperatedUids(hostState, moved);
  if (moved.length > 0) pushDuelLog(session.state, "overlay", target.controller, target.name, `Attached ${moved.length} material(s)`);
  return 0;
}

function applyReasonPayload(card: DuelCardInstance, payload: DuelEventPayload): void {
  if (payload.eventReasonCardUid !== undefined) card.reasonCardUid = payload.eventReasonCardUid;
  if (payload.eventReasonEffectId !== undefined) card.reasonEffectId = payload.eventReasonEffectId;
}

function pushRemoveOverlayCard(L: unknown, session: DuelSession, hostState: LuaDuelMoveApiHostState): number {
  if (session.state.status === "ended") {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const player = readOptionalPlayer(L, 1) ?? session.state.turnPlayer;
  const selfLocations = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const opponentLocations = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  const min = lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 1;
  const max = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : min;
  const reason = lua.lua_isnumber(L, 6) ? lua.lua_tointeger(L, 6) : duelReason.cost;
  const holders = overlayHoldersFromGroup(L, session, 7) ?? overlayHolders(session, player, selfLocations, opponentLocations);
  markLuaOperationTimingBoundary(session, hostState);
  const triggerStart = session.state.pendingTriggers.length;
  const detached = detachOverlayRange(session, holders, min, max, player, reason, hostState);
  regroupLuaOperationEvent(session, triggerStart, "sentToGraveyard", detached, "graveyard");
  regroupLuaOperationEvent(session, triggerStart, "detachedMaterial", detached, "graveyard");
  setOperatedUids(hostState, detached);
  if (hostState.activeContext && detached.length > 0) hostState.activeOperationMoved = true;
  lua.lua_pushinteger(L, detached.length);
  return 1;
}

function pushCheckRemoveOverlayCard(L: unknown, session: DuelSession): number {
  const player = readOptionalPlayer(L, 1) ?? session.state.turnPlayer;
  const selfLocations = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const opponentLocations = lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0;
  const count = Math.max(0, lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 1);
  const holders = overlayHoldersFromGroup(L, session, 6) ?? overlayHolders(session, player, selfLocations, opponentLocations);
  lua.lua_pushboolean(L, countOverlayMaterials(holders) >= count);
  return 1;
}

function overlayHoldersFromGroup(L: unknown, session: DuelSession, index: number): DuelCardInstance[] | undefined {
  if (lua.lua_gettop(L) < index || lua.lua_isnoneornil(L, index)) return undefined;
  const requested = new Set(readCardOrGroupUids(L, index));
  return session.state.cards.filter((card) => requested.has(card.uid) && card.overlayUids.length > 0);
}

function overlayHolders(session: DuelSession, player: PlayerId, selfMask: number, opponentMask: number): DuelCardInstance[] {
  return [
    ...overlayHoldersForPlayer(session, player, selfMask),
    ...overlayHoldersForPlayer(session, otherPlayer(player), opponentMask),
  ];
}

function overlayHoldersForPlayer(session: DuelSession, player: PlayerId, locationMask: number): DuelCardInstance[] {
  const locations = overlayLocationsFromMask(locationMask);
  if (locations.length === 0) return [];
  return session.state.cards.filter((card) => card.controller === player && locations.includes(card.location) && card.overlayUids.length > 0);
}

function detachOverlayRange(session: DuelSession, holders: DuelCardInstance[], min: number, max: number, player: PlayerId, reason: number, hostState: LuaDuelMoveApiHostState): string[] {
  const available = countOverlayMaterials(holders);
  const count = Math.min(Math.max(min, 0), Math.max(max, 0), available);
  if (count < min) return [];
  const detached: string[] = [];
  let remaining = count;
  for (const holder of holders) {
    if (remaining <= 0) break;
    const holderCount = Math.min(holder.overlayUids.length, remaining);
    const reasonPlayer = hostState.activeContext?.player ?? player;
    const materials = detachDuelOverlayMaterials(session.state, holder.uid, holderCount, player, reason, reasonPlayer, luaEffectReasonPayload(hostState, reason, reasonPlayer));
    detached.push(...materials.map((material) => material.uid));
    remaining -= holderCount;
  }
  return detached;
}

function countOverlayMaterials(holders: DuelCardInstance[]): number {
  return holders.reduce((total, holder) => total + holder.overlayUids.length, 0);
}

function overlayLocationsFromMask(mask: number): DuelLocation[] {
  if (mask === 1) return ["monsterZone"];
  return locationsFromMask(mask);
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function setOperatedUids(hostState: LuaDuelMoveApiHostState, uids: string[]): void {
  hostState.operatedUids.splice(0, hostState.operatedUids.length, ...uids);
}
