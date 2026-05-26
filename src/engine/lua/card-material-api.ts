import fengari from "fengari";
import { hasZoneSpace } from "#duel/card-state.js";
import { canChangeDuelCardPosition } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { fusionMaterialSelectionMatches } from "#duel/summon.js";
import { cardCombinations } from "#duel/summon-materials.js";
import type { MaterialUseKind } from "#duel/continuous-effects.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { canBeMaterial } from "#lua/card-eligibility-api.js";
import { cardTypeFlags } from "#lua/card-stat-api.js";
import { canLuaLinkSummonCard, readLinkMaterialArguments } from "#lua/link-summonable.js";
import { canLuaSynchroSummonCard } from "#lua/synchro-summonable.js";
import { canLuaXyzSummonCard } from "#lua/xyz-summonable.js";
import { positionFromMask, readCardUid, readGroupUids } from "#lua/api-utils.js";
import type { CardPosition, DuelCardInstance, DuelSession, DuelState } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardMaterialApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushIsSynchroSummonable(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsSynchroSummonable"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsXyzSummonable(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsXyzSummonable"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsLinkSummonable(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsLinkSummonable"));
  pushBooleanGetter(L, "IsCanTurnSet", session, (card) => Boolean(card && canTurnSet(session.state, card)));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? positionFromMask(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && canChangePosition(session.state, card, requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsCanChangePosition"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? positionFromMask(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && canChangePosition(session.state, card, requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsCanChangePositionRush"));
  pushBooleanGetter(L, "IsSSetable", session, (card) => Boolean(card && canLuaSetSpellTrapToAvailableZone(session.state, card)));
  pushMaterialPredicate(L, "IsCanBeFusionMaterial", session, "fusion");
  pushMaterialPredicate(L, "IsCanBeSynchroMaterial", session, "synchro");
  pushMaterialPredicate(L, "IsCanBeXyzMaterial", session, "xyz");
  pushMaterialPredicate(L, "IsCanBeLinkMaterial", session, "link");
  pushMaterialPredicate(L, "IsCanBeRitualMaterial", session, "ritual");
  lua.lua_pushcfunction(L, (state: unknown) => pushCheckFusionMaterial(state, session));
  lua.lua_setfield(L, -2, to_luastring("CheckFusionMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const card = readCard(state, session);
    if (card) card.summonMaterialUids = readCardOrGroupUids(state, 2);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SetMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const card = readCard(state, session);
    if (card) markProcedureComplete(card);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("CompleteProcedure"));
}

function pushIsSynchroSummonable(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const suppliedUids = [...readCardOrGroupUids(L, 2), ...readCardOrGroupUids(L, 3)];
  lua.lua_pushboolean(L, Boolean(card && canLuaSynchroSummonCard(session, card, suppliedUids)));
  return 1;
}

function pushIsXyzSummonable(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const suppliedUids = [...readCardOrGroupUids(L, 2), ...readCardOrGroupUids(L, 3)];
  lua.lua_pushboolean(L, Boolean(card && canLuaXyzSummonCard(session, card, suppliedUids)));
  return 1;
}

function pushIsLinkSummonable(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const { requiredUids, materialGroupUids, min, max } = readLinkMaterialArguments(L);
  lua.lua_pushboolean(L, Boolean(card && canLuaLinkSummonCard(session, card, requiredUids, materialGroupUids, min, max)));
  return 1;
}

function pushMaterialPredicate(L: unknown, fieldName: string, session: DuelSession, kind: MaterialUseKind): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const targetUid = readCardUid(state, 2);
    const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
    const reason = lua.lua_isnumber(state, 4) ? lua.lua_tointeger(state, 4) : defaultMaterialReason(kind);
    lua.lua_pushboolean(state, canBeMaterial(session.state, card, kind, target, reason));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushCheckFusionMaterial(L: unknown, session: DuelSession): number {
  const target = readCard(L, session);
  const poolUids = uniqueUids(readGroupUids(L, 2));
  const forcedUids = uniqueUids(readCardOrGroupUids(L, 3));
  if (!target) {
    lua.lua_pushboolean(L, false);
    return 1;
  }

  const candidates = (poolUids.length > 0
    ? poolUids
      .map((uid) => session.state.cards.find((card) => card.uid === uid))
      .filter((card): card is DuelCardInstance => Boolean(card && card.uid !== target.uid && canUseAsFusionMaterial(session.state, card)))
    : defaultFusionMaterialCandidates(session.state, target));
  const forced = forcedUids
    .map((uid) => candidates.find((card) => card.uid === uid))
    .filter((card): card is DuelCardInstance => card !== undefined);
  if (forced.length !== forcedUids.length) {
    lua.lua_pushboolean(L, false);
    return 1;
  }

  for (let count = Math.max(1, forced.length); count <= candidates.length; count += 1) {
    for (const materials of cardCombinations(candidates, count)) {
      if (forced.some((material) => !materials.includes(material))) continue;
      if (fusionMaterialSelectionMatches(session.state, target, materials)) {
        lua.lua_pushboolean(L, true);
        return 1;
      }
    }
  }
  lua.lua_pushboolean(L, false);
  return 1;
}

function canUseAsFusionMaterial(state: DuelState, card: DuelCardInstance): boolean {
  return isFusionMaterialLocation(card.location) && (cardTypeFlags(card, state) & 0x1) !== 0;
}

function defaultFusionMaterialCandidates(state: DuelState, target: DuelCardInstance): DuelCardInstance[] {
  return state.cards.filter((card) =>
    card.uid !== target.uid &&
    card.controller === target.controller &&
    (card.location === "hand" || card.location === "monsterZone") &&
    canUseAsFusionMaterial(state, card));
}

function isFusionMaterialLocation(location: DuelCardInstance["location"]): boolean {
  return location === "hand" || location === "monsterZone" || location === "graveyard" || location === "banished" || location === "deck" || location === "extraDeck" || location === "spellTrapZone";
}

function uniqueUids(uids: string[]): string[] {
  return [...new Set(uids)];
}

function defaultMaterialReason(kind: MaterialUseKind): number {
  if (kind === "fusion") return duelReason.material | duelReason.fusion;
  if (kind === "synchro") return duelReason.material | duelReason.synchro;
  if (kind === "xyz") return duelReason.material | duelReason.xyz;
  if (kind === "link") return duelReason.material | duelReason.link;
  return duelReason.material | duelReason.ritual;
}

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined, uid: string | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    lua.lua_pushboolean(state, getter(card, uid));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function canLuaSetSpellTrapToAvailableZone(state: DuelState, card: DuelCardInstance): boolean {
  if (!canLuaSetSpellTrap(card)) return false;
  if (card.location === "spellTrapZone") return true;
  return hasZoneSpace(state, card.controller, "spellTrapZone");
}

function canLuaSetSpellTrap(card: DuelCardInstance): boolean {
  return (card.kind === "spell" || card.kind === "trap") && (card.location === "hand" || card.location === "deck" || card.location === "graveyard" || card.location === "spellTrapZone");
}

function canTurnSet(state: DuelState, card: DuelCardInstance): boolean {
  if (card.location !== "monsterZone" || !card.faceUp) return false;
  if (card.kind !== "monster" && card.kind !== "extra") return false;
  if ((cardTypeFlags(card) & 0x4000000) !== 0) return false;
  return canLuaChangePosition(state, card, "faceDownDefense");
}

function canChangePosition(state: DuelState, card: DuelCardInstance, requested: CardPosition | undefined): boolean {
  if (requested) return canLuaChangePosition(state, card, requested);
  if (card.position === "faceUpAttack") return canLuaChangePosition(state, card, "faceUpDefense");
  if (card.position === "faceUpDefense" || card.position === "faceDownDefense") return canLuaChangePosition(state, card, "faceUpAttack");
  return false;
}

function canLuaChangePosition(state: DuelState, card: DuelCardInstance, position: CardPosition): boolean {
  return canChangeDuelCardPosition(state, card.uid, position, "effect");
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}
