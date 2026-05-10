import fengari from "fengari";
import { recordNormalSummonActivity, recordSpecialSummonActivity } from "#duel/activity.js";
import {
  isMonsterSetPrevented,
  isMaterialUsePrevented,
  isSpellTrapSetPrevented,
  type ContinuousEffectContextFactory,
  type MaterialUseKind,
} from "#duel/continuous-effects.js";
import {
  applyResponse,
  canMoveDuelCardToLocation,
  canPlayerSpecialSummon,
  canSpecialSummonDuelCard,
  collectDuelGroupedTriggerEffects,
  collectDuelTriggerEffects,
  fusionSummonDuelCard,
  linkSummonDuelCard,
  ritualSummonDuelCard,
  sendDuelCardToGraveyard,
  synchroSummonDuelCard,
  getLegalActions,
  moveDuelCard,
  negateDuelSummon,
  xyzSummonDuelCard,
} from "#duel/core.js";
import { duelSummonTypeFromCode, luaSummonTypeFusion, luaSummonTypePendulum, luaSummonTypeRitual } from "#duel/summon-type-codes.js";
import { hasZoneSpace, pushDuelLog } from "#duel/card-state.js";
import { canUseFusionSubstitute } from "#duel/fusion-substitute.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import type { DuelEventPayload } from "#duel/event-history.js";
import { duelReason } from "#duel/reasons.js";
import { tributeSetDuelCard } from "#duel/summon.js";
import { cardTypeFlags, currentLeftScale, currentLevel, currentRightScale } from "#duel/card-stats.js";
import { cardCombinations, materialCodesMatch, type MaterialCodeMatchOptions } from "#duel/summon-materials.js";
import { sameStringMembers } from "#duel/string-list-match.js";
import { setSpellTrap as setCoreSpellTrap } from "#duel/spell-trap.js";
import { positionFromMask, readCardUid, readGroupUids } from "#lua/api-utils.js";
import { availableMonsterZoneCount } from "#lua/duel-api/location.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { markLuaOperationTimingBoundary, type LuaOperationTimingBoundaryHostState } from "#lua/duel-api/move.js";
import { luaMoveBlockedByImmunity, type LuaMoveImmunityHostState } from "#lua/duel-api/move-immunity.js";
import { readCardOrGroupUids, readOptionalPlayer } from "#lua/duel-api/move-readers.js";
import { findLuaLinkMaterialUidSet } from "#lua/link-summonable.js";
import { findLuaSynchroMaterialUidSet } from "#lua/synchro-summonable.js";
import { findLuaXyzMaterialUidSet } from "#lua/xyz-summonable.js";
import { pushGroupTable } from "#lua/group-api.js";
import { applyMonsterZoneMask, hasOpenMonsterZone } from "#lua/monster-zone-mask.js";
import type { CardPosition, DuelAction, DuelCardInstance, DuelLocation, DuelSession, DuelState, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

type LuaSummonType = "FusionSummon" | "SynchroSummon" | "XyzSummon" | "LinkSummon" | "RitualSummon";
type LuaSummonOrSetAction = Extract<DuelAction, { type: "normalSummon" | "tributeSummon" | "setMonster" | "setSpellTrap" }>;

export interface LuaDuelSummonApiHostState extends LuaOperationTimingBoundaryHostState, LuaMoveImmunityHostState {
  operatedUids: string[];
  summonNegatedUids: string[];
  pendingSpecialSummonUids?: string[];
}

export function installDuelSummonApi(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): void {
  pushBasicSummonHelper(L, "Summon", session, hostState, "normalSummon");
  pushBasicSummonHelper(L, "MSet", session, hostState, "setMonster");
  pushBasicSummonHelper(L, "SSet", session, hostState, "setSpellTrap");
  lua.lua_pushcfunction(L, (state: unknown) => pushSummonOrSetResult(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SummonOrSet"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, true);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSummonCancelable"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = readOptionalPlayer(state, 1) ?? session.state.turnPlayer;
    lua.lua_pushboolean(state, session.state.players[player].normalSummonAvailable);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CheckSummonedCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const player = readOptionalPlayer(state, 1) ?? session.state.turnPlayer;
    if (session.state.players[player].normalSummonAvailable) recordNormalSummonActivity(session.state, player);
    session.state.players[player].normalSummonAvailable = false;
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("IncreaseSummonedCount"));
  pushSummonHelper(L, "FusionSummon", session, hostState, "FusionSummon");
  pushSummonHelper(L, "SynchroSummon", session, hostState, "SynchroSummon");
  pushSummonHelper(L, "XyzSummon", session, hostState, "XyzSummon");
  pushSummonHelper(L, "LinkSummon", session, hostState, "LinkSummon");
  pushSummonHelper(L, "RitualSummon", session, hostState, "RitualSummon");
  lua.lua_pushcfunction(L, (state: unknown) => pushRitualMaterial(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetRitualMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => pushReleaseRitualMaterial(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("ReleaseRitualMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => pushPendulumSummon(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("PendulumSummon"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSpecialSummonStep(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SpecialSummonStep"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSpecialSummonComplete(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("SpecialSummonComplete"));
  lua.lua_pushcfunction(L, (state: unknown) => pushNegateSummon(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("NegateSummon"));
}

function pushBasicSummonHelper(L: unknown, fieldName: string, session: DuelSession, hostState: LuaDuelSummonApiHostState, type: "normalSummon" | "setMonster" | "setSpellTrap"): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushBasicSummonResult(state, session, hostState, type));
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushSummonHelper(L: unknown, fieldName: string, session: DuelSession, hostState: LuaDuelSummonApiHostState, summonType: LuaSummonType): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, hostState, summonType));
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushSummonOrSetResult(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): number {
  if (session.state.status === "ended") return pushEmptyIntegerResult(L, hostState);
  const player = readOptionalPlayer(L, 1) ?? session.state.turnPlayer;
  const targetUid = readFirstCardOrGroupUid(L, 2);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (!target) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const tributeUids = readCardCollectionUids(L, 4);
  const action = selectSummonOrSetAction(session, player, target, tributeUids);
  const result = action ? applyResponse(session, action) : { ok: false };
  setOperatedUids(hostState, result.ok ? [target.uid] : []);
  lua.lua_pushinteger(L, result.ok ? 1 : 0);
  return 1;
}

function selectSummonOrSetAction(
  session: DuelSession,
  player: PlayerId,
  target: DuelCardInstance,
  tributeUids: string[],
): LuaSummonOrSetAction | undefined {
  const actions = getLegalActions(session, player);
  const summon = actions.find((candidate): candidate is LuaSummonOrSetAction => candidate.type === "normalSummon" && candidate.uid === target.uid);
  if (summon) return summon;
  if (tributeUids.length > 0) return actions.find((candidate): candidate is LuaSummonOrSetAction => candidate.type === "tributeSummon" && candidate.uid === target.uid && sameStringMembers(candidate.tributeUids, tributeUids));
  return actions.find((candidate): candidate is LuaSummonOrSetAction => candidate.type === "setMonster" && candidate.uid === target.uid);
}

function pushBasicSummonResult(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState, type: "normalSummon" | "setMonster" | "setSpellTrap"): number {
  if (session.state.status === "ended") return pushEmptyIntegerResult(L, hostState);
  const targetUid = readFirstCardOrGroupUid(L, type === "setSpellTrap" && lua.lua_isnumber(L, 1) ? 2 : 1);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (!target) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const tributeUids = type === "normalSummon" || type === "setMonster" ? readCardCollectionUids(L, 3) : [];
  const legalAction = selectBasicSummonAction(session, target, type, tributeUids);
  if (legalAction) markLuaOperationTimingBoundary(session, hostState);
  const result =
    legalAction
      ? applyResponse(session, legalAction)
      : type === "setSpellTrap"
      ? setLuaSpellTrap(session, hostState, target)
      : type === "setMonster" && tributeUids.length > 0
      ? setLuaMonsterWithTributes(session, target, tributeUids)
      : { ok: false };
  if (result.ok && hostState.activeContext) hostState.activeOperationMoved = true;
  setOperatedUids(hostState, result.ok ? [target.uid] : []);
  lua.lua_pushinteger(L, result.ok ? 1 : 0);
  return 1;
}

function selectBasicSummonAction(
  session: DuelSession,
  target: DuelCardInstance,
  type: "normalSummon" | "setMonster" | "setSpellTrap",
  tributeUids: string[],
): LuaSummonOrSetAction | undefined {
  const actions = getLegalActions(session, target.controller);
  if (type === "normalSummon" && tributeUids.length > 0) {
    return actions.find((action): action is LuaSummonOrSetAction => action.type === "tributeSummon" && action.uid === target.uid && sameStringMembers(action.tributeUids, tributeUids));
  }
  return actions.find((action): action is LuaSummonOrSetAction => action.type === type && action.uid === target.uid);
}

function setLuaMonsterWithTributes(session: DuelSession, target: DuelCardInstance, tributeUids: string[]): { ok: boolean } {
  if (isMonsterSetPrevented(session.state, target.controller, target, createMaterialCheckContext(session.state))) return { ok: false };
  const reason = duelReason.release | duelReason.summon;
  try {
    tributeSetDuelCard(
      session.state,
      target.controller,
      target.uid,
      tributeUids,
      (uid, controller, moveReason) => ({ card: sendDuelCardToGraveyard(session.state, uid, controller, moveReason) }),
      (uid) => canMoveDuelCardToLocation(session.state, uid, "graveyard", reason),
      (eventName, eventCard) => collectLuaSummonEvent(session, eventName, eventCard),
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function setLuaSpellTrap(session: DuelSession, hostState: LuaDuelSummonApiHostState, target: DuelCardInstance): { ok: boolean } {
  if (!canLuaSetSpellTrap(session, target)) return { ok: false };
  markLuaOperationTimingBoundary(session, hostState);
  if (target.location === "hand") {
    setCoreSpellTrap(session.state, target.controller, target.uid, (eventName, eventCard) => collectLuaSummonEvent(session, eventName, eventCard));
  } else {
    moveDuelCard(session.state, target.uid, "spellTrapZone", target.controller, duelReason.rule, session.state.turnPlayer);
    target.position = "faceDown";
    target.faceUp = false;
    pushDuelLog(session.state, "set", target.controller, target.name, `Set from ${target.previousLocation}`);
    collectLuaSummonEvent(session, "spellTrapSet", target);
  }
  return { ok: true };
}

function canLuaSetSpellTrap(session: DuelSession, target: DuelCardInstance): boolean {
  return (
    (target.kind === "spell" || target.kind === "trap") &&
    (target.location === "hand" || target.location === "deck" || target.location === "graveyard") &&
    hasZoneSpace(session.state, target.controller, "spellTrapZone") &&
    !isSpellTrapSetPrevented(session.state, target.controller, target, createMaterialCheckContext(session.state))
  );
}

function pushLuaSummonResult(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState, summonType: LuaSummonType): number {
  if (session.state.status === "ended") return pushEmptyIntegerResult(L, hostState);
  const playerFirst = lua.lua_isnumber(L, 1) && readCardUid(L, 2) !== undefined;
  const player = playerFirst ? readOptionalPlayer(L, 1) ?? session.state.turnPlayer : undefined;
  const targetUid = readCardUid(L, playerFirst ? 2 : 1);
  const materialUids = playerFirst ? readCardOrGroupUids(L, 3) : readCardOrGroupUids(L, 2);
  const alreadyMovedIndex = playerFirst ? 4 : 3;
  const positionIndex = playerFirst ? 5 : 4;
  const materialsAlreadyMoved = (summonType === "FusionSummon" || summonType === "RitualSummon") && readOptionalBoolean(L, alreadyMovedIndex);
  const fusionMaterialsMovedByEffect = summonType === "FusionSummon" && Boolean(lua.lua_toboolean(L, playerFirst ? 5 : 4));
  const requestedPosition = summonType === "RitualSummon" ? readOptionalSummonPosition(L, positionIndex) ?? readOptionalSummonPosition(L, alreadyMovedIndex) : undefined;
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (!target) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  try {
    const summonPlayer = player ?? target.controller;
    const selectedMaterials =
      materialUids.length > 0
        ? materialUids
        : summonType === "SynchroSummon"
          ? findLuaSynchroMaterialUidSet(session, target, []) ?? []
          : summonType === "XyzSummon"
            ? findLuaXyzMaterialUidSet(session, target, [], summonPlayer) ?? []
            : summonType === "LinkSummon"
              ? findLuaLinkMaterialUidSet(session, target, [], []) ?? []
              : materialUids;
    markLuaOperationTimingBoundary(session, hostState);
    if (summonType === "FusionSummon") {
      if (fusionMaterialsMovedByEffect || materialsAlreadyMoved || selectedMaterials.some((uid) => session.state.cards.some((card) => card.uid === uid && !isDefaultFusionMaterialLocation(card.location)))) {
        const materialReason = duelReason.material | duelReason.fusion | (fusionMaterialsMovedByEffect ? duelReason.effect : 0);
        fusionSummonSelectedMaterials(session, hostState, target, selectedMaterials, summonPlayer, materialsAlreadyMoved, materialReason);
      } else {
        fusionSummonDuelCard(session.state, summonPlayer, target.uid, selectedMaterials);
      }
    }
    else if (summonType === "SynchroSummon") synchroSummonDuelCard(session.state, summonPlayer, target.uid, selectedMaterials);
    else if (summonType === "XyzSummon") xyzSummonDuelCard(session.state, summonPlayer, target.uid, selectedMaterials);
    else if (summonType === "LinkSummon") linkSummonDuelCard(session.state, summonPlayer, target.uid, selectedMaterials);
    else if (target.data.ritualMaterials?.length) ritualSummonDuelCard(session.state, target.controller, target.uid, materialUids, requestedPosition);
    else ritualSummonSelectedMaterials(session, hostState, target, materialUids, materialsAlreadyMoved, requestedPosition);
    if (hostState.activeContext) hostState.activeOperationMoved = true;
    setOperatedUids(hostState, [target.uid]);
    lua.lua_pushinteger(L, 1);
  } catch {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
  }
  return 1;
}

function readOptionalBoolean(L: unknown, index: number): boolean {
  return lua.lua_type(L, index) === lua.LUA_TBOOLEAN && Boolean(lua.lua_toboolean(L, index));
}

function readOptionalSummonPosition(L: unknown, index: number): CardPosition | undefined {
  return lua.lua_isnumber(L, index) ? positionFromMask(lua.lua_tointeger(L, index)) : undefined;
}

function fusionSummonSelectedMaterials(
  session: DuelSession,
  hostState: LuaDuelSummonApiHostState,
  target: DuelCardInstance,
  materialUids: string[],
  summonPlayer: PlayerId,
  materialsAlreadyMoved = false,
  materialReason = duelReason.material | duelReason.fusion,
): void {
  if (!isMonsterLike(session.state, target) || !isSelectedFusionTargetLocation(target.location)) throw new Error(`${target.name} is not a Fusion monster in a summonable location`);
  if (new Set(materialUids).size !== materialUids.length || materialUids.length === 0) throw new Error(`${target.name} fusion materials are not legal`);
  const materials = materialUids.map((uid) => session.state.cards.find((candidate) => candidate.uid === uid));
  if (
    availableMonsterZoneCount(session, summonPlayer, materialUids) <= 0 ||
    !canPlayerSpecialSummon(session.state, summonPlayer, target, luaSummonTypeFusion) ||
    !canMoveDuelCardToLocation(session.state, target.uid, "monsterZone", duelReason.summon | duelReason.specialSummon | duelReason.fusion) ||
    !selectedFusionMaterialsMatch(session, target, materials)
  ) {
    throw new Error(`${target.name} cannot be Fusion Summoned`);
  }
  const pendingDefaultMaterialUids: string[] = [];
  for (const material of materials) {
    if (materialsAlreadyMoved) {
      if (canMoveUnmovedFusionMaterial(session, material, target)) {
        pendingDefaultMaterialUids.push(material.uid);
        continue;
      }
      if (!canTrackMovedFusionMaterial(session, material, target)) throw new Error(`${target.name} fusion materials are not legal`);
      continue;
    }
    if (!canBeSelectedFusionMaterial(session, material, target)) throw new Error(`${target.name} fusion materials are not legal`);
  }
  const materialUidsToMove = materialsAlreadyMoved ? pendingDefaultMaterialUids : materialUids;
  for (const uid of materialUidsToMove) {
    const material = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!material) continue;
    collectLuaSummonEvent(session, "preUsedAsMaterial", material);
    sendDuelCardToGraveyard(session.state, uid, material.controller, materialReason, summonPlayer);
    pushDuelLog(session.state, "fusionMaterial", summonPlayer, material.name, `Used for ${target.name}`);
    collectLuaSummonEvent(session, "usedAsMaterial", material);
  }
  hostState.activeOperationMoved = true;
  collectLuaSummonEvent(session, "specialSummoning", target);
  moveDuelCard(session.state, target.uid, "monsterZone", summonPlayer, duelReason.summon | duelReason.specialSummon | duelReason.fusion, summonPlayer);
  target.position = "faceUpAttack";
  target.faceUp = true;
  target.summonType = "fusion";
  target.summonPlayer = summonPlayer;
  target.summonPhase = session.state.phase;
  target.summonMaterialUids = [...materialUids];
  markProcedureComplete(target);
  recordSpecialSummonActivity(session.state, summonPlayer, target);
  pushDuelLog(session.state, "fusionSummon", summonPlayer, target.name, `Fusion Summoned with ${materialUids.length} material(s)`);
  collectLuaSummonEvent(session, "specialSummoned", target);
}

function isSelectedFusionTargetLocation(location: DuelLocation): boolean {
  return location === "extraDeck";
}

function canBeSelectedFusionMaterial(session: DuelSession, material: DuelCardInstance | undefined, target: DuelCardInstance): boolean {
  if (!material) return false;
  return (
    isMonsterLike(session.state, material) &&
    isSelectedFusionMaterialLocation(material.location) &&
    material.uid !== target.uid &&
    targetAllowsFusionMaterial(session.state, target, material) &&
    !isMaterialUsePrevented(session.state, material.uid, "fusion", createMaterialCheckContext(session.state))
  );
}

function canMoveUnmovedFusionMaterial(session: DuelSession, material: DuelCardInstance | undefined, target: DuelCardInstance): material is DuelCardInstance {
  return Boolean(material && isDefaultFusionMaterialLocation(material.location) && canBeSelectedFusionMaterial(session, material, target));
}

function canTrackMovedFusionMaterial(session: DuelSession, material: DuelCardInstance | undefined, target: DuelCardInstance): boolean {
  return Boolean(material && isMonsterLike(session.state, material) && material.uid !== target.uid && targetAllowsFusionMaterial(session.state, target, material));
}

function isDefaultFusionMaterialLocation(location: DuelLocation): boolean {
  return location === "hand" || location === "monsterZone";
}

function isSelectedFusionMaterialLocation(location: DuelLocation): boolean {
  return isDefaultFusionMaterialLocation(location) || location === "deck" || location === "graveyard" || location === "banished" || location === "extraDeck" || location === "spellTrapZone";
}

function selectedFusionMaterialsMatch(session: DuelSession, target: DuelCardInstance, materials: (DuelCardInstance | undefined)[]): boolean {
  const required = target.data.fusionMaterials ?? [];
  if (!required.length) return materials.length > 0 && materials.every((material) => material !== undefined);
  const selected = materials.filter((material): material is DuelCardInstance => material !== undefined);
  return selected.length === materials.length && materialCodesMatch(selected, required, fusionMaterialMatchOptions(session.state, target));
}

function ritualSummonSelectedMaterials(
  session: DuelSession,
  hostState: LuaDuelSummonApiHostState,
  target: DuelCardInstance,
  materialUids: string[],
  materialsAlreadyMoved = false,
  position: CardPosition = "faceUpAttack",
): void {
  if (target.kind !== "monster" || !isSelectedRitualTargetLocation(target.location)) throw new Error(`${target.name} is not a ritual monster in a summonable location`);
  if (new Set(materialUids).size !== materialUids.length || materialUids.length === 0) throw new Error(`${target.name} ritual materials are not legal`);
  if (
    availableMonsterZoneCount(session, target.controller, materialUids) <= 0 ||
    !canPlayerSpecialSummon(session.state, target.controller, target, luaSummonTypeRitual) ||
    !canMoveDuelCardToLocation(session.state, target.uid, "monsterZone", duelReason.summon | duelReason.specialSummon | duelReason.ritual)
  ) {
    throw new Error(`${target.name} cannot be Ritual Summoned`);
  }
  for (const uid of materialUids) {
    const material = session.state.cards.find((candidate) => candidate.uid === uid);
    const canUseMaterial = materialsAlreadyMoved ? canTrackMovedRitualMaterial(session, material, target) : canBeSelectedRitualMaterial(session, material, target);
    if (!canUseMaterial) {
      throw new Error(`${target.name} ritual materials are not legal`);
    }
  }
  if (!materialsAlreadyMoved) {
    for (const uid of materialUids) {
      const material = session.state.cards.find((candidate) => candidate.uid === uid);
      if (!material) continue;
      sendDuelCardToGraveyard(session.state, uid, target.controller, duelReason.material | duelReason.ritual, target.controller);
      pushDuelLog(session.state, "ritualMaterial", target.controller, material.name, `Used for ${target.name}`);
    }
  }
  hostState.activeOperationMoved = true;
  moveDuelCard(session.state, target.uid, "monsterZone", target.controller, duelReason.summon | duelReason.specialSummon | duelReason.ritual);
  applySummonPosition(target, position);
  target.summonType = "ritual";
  target.summonPlayer = target.controller;
  target.summonPhase = session.state.phase;
  target.summonMaterialUids = [...materialUids];
  recordSpecialSummonActivity(session.state, target.controller, target);
  pushDuelLog(session.state, "ritualSummon", target.controller, target.name, `Ritual Summoned with ${materialUids.length} material(s)`);
  markLuaOperationTimingBoundary(session, hostState);
  collectLuaSummonEvent(session, "specialSummoned", target);
}

function isSelectedRitualTargetLocation(location: DuelLocation): boolean {
  return location === "hand" || location === "graveyard" || location === "deck" || location === "spellTrapZone";
}

function canBeSelectedRitualMaterial(session: DuelSession, material: DuelCardInstance | undefined, target: DuelCardInstance): boolean {
  if (!material) return false;
  return (
    isMonsterLike(session.state, material) &&
    isSelectedRitualMaterialLocation(material.location) &&
    material.controller === target.controller &&
    material.uid !== target.uid &&
    targetAllowsMaterial(target, material, "ritual") &&
    !isMaterialUsePrevented(session.state, material.uid, "ritual", createMaterialCheckContext(session.state))
  );
}

function canTrackMovedRitualMaterial(session: DuelSession, material: DuelCardInstance | undefined, target: DuelCardInstance): boolean {
  return Boolean(material && isMonsterLike(session.state, material) && material.uid !== target.uid && targetAllowsMaterial(target, material, "ritual"));
}

function isSelectedRitualMaterialLocation(location: DuelLocation): boolean {
  return location === "hand" || location === "monsterZone" || location === "deck" || location === "graveyard" || location === "extraDeck";
}

function collectLuaSummonEvent(session: DuelSession, eventName: Parameters<typeof collectDuelTriggerEffects>[1], eventCard?: DuelCardInstance): void {
  const payload: DuelEventPayload = {};
  if (eventCard?.reason !== undefined) payload.eventReason = eventCard.reason;
  if (eventCard?.reasonPlayer !== undefined) payload.eventReasonPlayer = eventCard.reasonPlayer;
  collectDuelTriggerEffects(session.state, eventName, eventCard, payload);
}

function pushRitualMaterial(L: unknown, session: DuelSession): number {
  const player = readOptionalPlayer(L, 1) ?? session.state.turnPlayer;
  const targetUid = readCardUid(L, 2);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  pushGroupTable(
    L,
    ritualMaterialCandidates(session.state, player, target).map((card) => card.uid),
  );
  return 1;
}

function pushReleaseRitualMaterial(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): number {
  if (session.state.status === "ended") return pushEmptyIntegerResult(L, hostState);
  const reason = duelReason.release | duelReason.material | duelReason.ritual;
  const moved: string[] = [];
  for (const uid of readCardOrGroupUids(L, 1)) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card) continue;
    try {
      const result = sendDuelCardToGraveyard(session.state, uid, card.controller, reason, session.state.turnPlayer);
      if (result.location === "graveyard") moved.push(uid);
    } catch {
      // EDOPro-style helpers report successful material releases only.
    }
  }
  setOperatedUids(hostState, moved);
  lua.lua_pushinteger(L, moved.length);
  return 1;
}

function pushPendulumSummon(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): number {
  if (session.state.status === "ended") return pushEmptyIntegerResult(L, hostState);
  const player = readOptionalPlayer(L, 1) ?? session.state.turnPlayer;
  const zoneCount = availableMonsterZoneCount(session, player, []);
  const scales = pendulumScales(session, player);
  if (!isMainPhaseForPlayer(session, player) || !session.state.players[player].pendulumSummonAvailable || zoneCount <= 0 || !scales) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }

  const [lowScale, highScale] = scales;
  const summonedUids: string[] = [];
  const reasonPlayer = hostState.activeContext?.player ?? player;
  const payload = luaEffectReasonPayload(hostState, duelReason.summon | duelReason.specialSummon, reasonPlayer);
  for (const card of pendulumSummonCandidates(session, player, lowScale, highScale).slice(0, zoneCount)) {
    try {
      const summoned = specialSummonStepCard(session, card, player, luaSummonTypePendulum, reasonPlayer, payload);
      if (!summoned) throw new Error(`${card.name} cannot be Pendulum Summoned`);
      applySummonPosition(summoned, "faceUpAttack");
      summoned.summonType = "pendulum";
      markProcedureComplete(summoned);
      summonedUids.push(summoned.uid);
    } catch {
      // EDOPro-style helpers report successful summons only.
    }
  }
  if (summonedUids.length > 0) {
    session.state.players[player].pendulumSummonAvailable = false;
    collectDuelGroupedTriggerEffects(session.state, "specialSummoned", summonedUids.map((uid) => session.state.cards.find((candidate) => candidate.uid === uid)).filter((card): card is DuelCardInstance => Boolean(card)), { ...payload, eventUids: summonedUids });
  }
  setOperatedUids(hostState, summonedUids);
  lua.lua_pushinteger(L, summonedUids.length);
  return 1;
}

function pushSpecialSummonStep(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): number {
  if (session.state.status === "ended") return pushEmptyBooleanResult(L, hostState);
  const uid = readCardUid(L, 1);
  const summonType = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const target = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
  const targetPlayer = readOptionalPlayer(L, 4) ?? target?.controller;
  const requestedPosition = lua.lua_isnumber(L, 7) ? positionFromMask(lua.lua_tointeger(L, 7)) : undefined;
  const zoneMask = lua.lua_isnumber(L, 8) ? lua.lua_tointeger(L, 8) : undefined;
  if (
    !uid ||
    !target ||
    targetPlayer === undefined ||
    !hasOpenMonsterZone(session, targetPlayer, zoneMask) ||
    luaMoveBlockedByImmunity(L, session, hostState, target, duelReason.effect | duelReason.summon | duelReason.specialSummon)
  ) {
    lua.lua_pushboolean(L, false);
    return 1;
  }
  try {
    markLuaOperationTimingBoundary(session, hostState);
    const reasonPlayer = hostState.activeContext?.player ?? targetPlayer;
    const payload = luaEffectReasonPayload(hostState, duelReason.summon | duelReason.specialSummon, reasonPlayer);
    const summoned = specialSummonStepCard(session, target, targetPlayer, summonType, reasonPlayer, payload);
    if (!summoned) throw new Error(`${target.name} cannot be Special Summoned`);
    if (requestedPosition) applySummonPosition(summoned, requestedPosition);
    applyMonsterZoneMask(session, summoned, targetPlayer, zoneMask);
    if (hostState.activeContext) hostState.activeOperationMoved = true;
    hostState.pendingSpecialSummonUids = [...(hostState.pendingSpecialSummonUids ?? []), uid];
    setOperatedUids(hostState, hostState.pendingSpecialSummonUids);
    lua.lua_pushboolean(L, true);
    return 1;
  } catch {
    lua.lua_pushboolean(L, false);
    return 1;
  }
}

function specialSummonStepCard(
  session: DuelSession,
  card: DuelCardInstance,
  player: PlayerId,
  summonType: number,
  reasonPlayer: PlayerId,
  payload: DuelEventPayload,
): DuelCardInstance | undefined {
  const canSummon =
    canSpecialSummonDuelCard(session.state, card.uid, player, summonType, payload.eventReasonEffectId) ||
    (card.location === "extraDeck" &&
      summonType !== 0 &&
      canPlayerSpecialSummon(session.state, player, card, summonType, payload.eventReasonEffectId) &&
      canMoveDuelCardToLocation(session.state, card.uid, "monsterZone", duelReason.summon | duelReason.specialSummon));
  if (!canSummon) return undefined;
  collectDuelTriggerEffects(session.state, "specialSummoning", card, payload);
  const summoned = moveDuelCard(session.state, card.uid, "monsterZone", player, duelReason.summon | duelReason.specialSummon, reasonPlayer);
  if (payload.eventReasonCardUid !== undefined) summoned.reasonCardUid = payload.eventReasonCardUid;
  if (payload.eventReasonEffectId !== undefined) summoned.reasonEffectId = payload.eventReasonEffectId;
  summoned.position = "faceUpAttack";
  summoned.faceUp = true;
  summoned.summonType = duelSummonTypeFromCode(summonType);
  summoned.summonTypeCode = summonType;
  summoned.summonPlayer = player;
  summoned.summonPhase = session.state.phase;
  summoned.summonMaterialUids = [];
  recordSpecialSummonActivity(session.state, player, summoned);
  pushDuelLog(session.state, "specialSummon", player, summoned.name, "Special Summoned");
  return summoned;
}

function pushSpecialSummonComplete(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): number {
  if (session.state.status === "ended") {
    hostState.pendingSpecialSummonUids = [];
    return pushEmptyIntegerResult(L, hostState);
  }
  const completed = hostState.pendingSpecialSummonUids ?? [];
  const completedCards = completed.map((uid) => session.state.cards.find((candidate) => candidate.uid === uid)).filter((card): card is DuelCardInstance => Boolean(card));
  if (completedCards.length > 0) collectDuelGroupedTriggerEffects(session.state, "specialSummoned", completedCards, { eventUids: completed });
  setOperatedUids(hostState, completed);
  hostState.pendingSpecialSummonUids = [];
  lua.lua_pushinteger(L, completed.length);
  return 1;
}

function pushNegateSummon(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): number {
  if (session.state.status === "ended") return pushEmptyIntegerResult(L, hostState);
  const negated: string[] = [];
  for (const uid of readCardOrGroupUids(L, 1)) {
    try {
      if (negateDuelSummon(session.state, uid)) negated.push(uid);
    } catch {
      // EDOPro-style helpers report successful negations only.
    }
  }
  setOperatedUids(hostState, negated);
  for (const uid of negated) {
    if (!hostState.summonNegatedUids.includes(uid)) hostState.summonNegatedUids.push(uid);
  }
  lua.lua_pushinteger(L, negated.length);
  return 1;
}

function readFirstCardOrGroupUid(L: unknown, index: number): string | undefined {
  return readCardUid(L, index) ?? readGroupUids(L, index)[0];
}

function readCardCollectionUids(L: unknown, index: number): string[] {
  const directUids = readCardOrGroupUids(L, index);
  if (directUids.length > 0 || !lua.lua_istable(L, index)) return directUids;
  const count = lua.lua_rawlen(L, index);
  const uids: string[] = [];
  for (let luaIndex = 1; luaIndex <= count; luaIndex += 1) {
    lua.lua_rawgeti(L, index, luaIndex);
    const uid = readCardUid(L, -1);
    if (uid) uids.push(uid);
    lua.lua_pop(L, 1);
  }
  return uids;
}

function ritualMaterialCandidates(state: DuelState, player: PlayerId, target: DuelCardInstance | undefined): DuelCardInstance[] {
  return state.cards
    .filter((card) => card.controller === player && canBeRitualMaterial(state, card, target))
    .sort((a, b) => locationSort(a.location) - locationSort(b.location) || a.sequence - b.sequence);
}

function canBeRitualMaterial(state: DuelState, card: DuelCardInstance, target: DuelCardInstance | undefined): boolean {
  return (
    isMonsterLike(state, card) &&
    (card.location === "hand" || card.location === "monsterZone") &&
    targetAllowsMaterial(target, card, "ritual") &&
    !isMaterialUsePrevented(state, card.uid, "ritual", createMaterialCheckContext(state))
  );
}

function pendulumSummonCandidates(session: DuelSession, player: PlayerId, lowScale: number, highScale: number): DuelCardInstance[] {
  return session.state.cards
    .filter((card) => canPendulumSummonCard(session, player, card, lowScale, highScale))
    .sort((a, b) => locationSort(a.location) - locationSort(b.location) || a.sequence - b.sequence);
}

function canPendulumSummonCard(session: DuelSession, player: PlayerId, card: DuelCardInstance, lowScale: number, highScale: number): boolean {
  if (card.controller !== player || !isPendulumMonster(session.state, card)) return false;
  if (card.location !== "hand" && !(card.location === "extraDeck" && card.faceUp)) return false;
  const level = currentLevel(card, session.state);
  if (level <= lowScale || level >= highScale) return false;
  return canSpecialSummonDuelCard(session.state, card.uid, player, luaSummonTypePendulum);
}

function pendulumScales(session: DuelSession, player: PlayerId): [number, number] | undefined {
  const left = pendulumZoneCard(session, player, 0);
  const right = pendulumZoneCard(session, player, 1);
  if (!left || !right) return undefined;
  const low = Math.min(pendulumScale(left), pendulumScale(right));
  const high = Math.max(pendulumScale(left), pendulumScale(right));
  return low < high ? [low, high] : undefined;
}

function pendulumZoneCard(session: DuelSession, player: PlayerId, sequence: number): DuelCardInstance | undefined {
  return session.state.cards.find((card) => card.controller === player && card.location === "spellTrapZone" && card.sequence === sequence && isPendulumCard(session.state, card));
}

function pendulumScale(card: DuelCardInstance): number {
  return card.data.leftScale === undefined ? currentRightScale(card) : currentLeftScale(card);
}

function targetAllowsMaterial(target: DuelCardInstance | undefined, card: DuelCardInstance, kind: MaterialUseKind): boolean {
  if (!target) return true;
  if (target.uid === card.uid) return false;
  const codes = cardCodes(card);
  if (kind === "fusion") return !target.data.fusionMaterials?.length || target.data.fusionMaterials.some((code) => codes.includes(code));
  if (kind === "ritual") return !target.data.ritualMaterials?.length || target.data.ritualMaterials.some((code) => codes.includes(code));
  return true;
}

function targetAllowsFusionMaterial(state: DuelState, target: DuelCardInstance | undefined, card: DuelCardInstance): boolean {
  if (!target) return true;
  if (target.uid === card.uid) return false;
  const requiredCodes = target.data.fusionMaterials ?? [];
  if (!requiredCodes.length) return true;
  const codes = cardCodes(card);
  return requiredCodes.some((code) => codes.includes(code)) || canUseFusionSubstitute(state, card, target);
}

function fusionMaterialMatchOptions(state: DuelState, target: DuelCardInstance): MaterialCodeMatchOptions {
  return {
    maxSubstitutes: 1,
    canSubstitute: (material, code) => !cardCodes(material).includes(code) && canUseFusionSubstitute(state, material, target),
  };
}

function locationSort(location: DuelLocation): number {
  if (location === "hand") return 0;
  if (location === "monsterZone") return 1;
  return 2;
}

function createMaterialCheckContext(state: DuelState): ContinuousEffectContextFactory {
  return (effect, source, card) => ({
    duel: state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: card ? [card.uid] : [],
    log() {},
    moveCard(uid, to, controller) {
      return moveDuelCard(state, uid, to, controller);
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return card ? [card] : [];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}

function isMonsterLike(state: DuelState, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, state) & 0x1) !== 0;
}

function isMainPhaseForPlayer(session: DuelSession, player: PlayerId): boolean {
  return session.state.turnPlayer === player && (session.state.phase === "main1" || session.state.phase === "main2");
}

function isPendulumMonster(state: DuelState, card: DuelCardInstance): boolean {
  return isMonsterLike(state, card) && isPendulumCard(state, card);
}

function isPendulumCard(state: DuelState, card: DuelCardInstance): boolean {
  return (cardTypeFlags(card, state) & 0x1000000) !== 0;
}

function cardCodes(card: DuelCardInstance): string[] {
  return card.data.alias ? [card.code, card.data.alias] : [card.code];
}

function applySummonPosition(card: { position: CardPosition; faceUp: boolean }, position: CardPosition): void {
  card.position = position;
  card.faceUp = position !== "faceDownDefense";
}

function setOperatedUids(hostState: LuaDuelSummonApiHostState, uids: string[]): void {
  hostState.operatedUids.splice(0, hostState.operatedUids.length, ...uids);
}

function pushEmptyIntegerResult(L: unknown, hostState: LuaDuelSummonApiHostState): number {
  setOperatedUids(hostState, []);
  lua.lua_pushinteger(L, 0);
  return 1;
}

function pushEmptyBooleanResult(L: unknown, hostState: LuaDuelSummonApiHostState): number {
  setOperatedUids(hostState, []);
  lua.lua_pushboolean(L, false);
  return 1;
}
