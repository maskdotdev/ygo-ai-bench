import fengari from "fengari";
import { readCardUid } from "#lua/api-utils.js";
import { linkedGroupUidsForCard, linkedZoneMask } from "#lua/duel-api/location.js";
import { pushGroupTable } from "#lua/group-api.js";
import { cardLink } from "#lua/card-stat-api.js";
import type { DuelCardInstance, DuelSession, DuelState } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardLinkedApi(L: unknown, session: DuelSession): void {
  pushBooleanGetter(L, "IsLinked", session, (card) => Boolean(card && isLinkedMonsterZoneCard(session.state, card)));
  pushNumberGetter(L, "GetLinkedZone", session, (card) => (card ? linkedZoneMask(card) : 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    pushGroupTable(state, card ? linkedGroupUidsForCard(session, card) : []);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLinkedGroup"));
  pushNumberGetter(L, "GetLinkedGroupCount", session, (card) => (card ? linkedGroupUidsForCard(session, card).length : 0));
}

function pushNumberGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => number): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function isLinkedMonsterZoneCard(state: DuelState, card: DuelCardInstance): boolean {
  if (card.location !== "monsterZone" || !card.faceUp) return false;
  return monsterZoneCards(state).some((candidate) => {
    if (candidate.uid === card.uid || !candidate.faceUp) return false;
    return linkPointsTo(candidate, card) || linkPointsTo(card, candidate);
  });
}

function monsterZoneCards(state: DuelState): DuelCardInstance[] {
  return state.cards.filter((card) => card.location === "monsterZone");
}

function linkPointsTo(source: DuelCardInstance, target: DuelCardInstance): boolean {
  if (source.controller !== target.controller || cardLink(source) <= 0) return false;
  return linkedSequences(source.sequence, source.data.linkMarkers ?? 0).includes(target.sequence);
}

function linkedSequences(sequence: number, markers: number): number[] {
  const sequences: number[] = [];
  if ((markers & 0x8) !== 0) sequences.push(sequence - 1);
  if ((markers & 0x20) !== 0) sequences.push(sequence + 1);
  if ((markers & 0x1) !== 0 || (markers & 0x2) !== 0 || (markers & 0x4) !== 0) sequences.push(sequence);
  return sequences.filter((target) => target >= 0 && target <= 6);
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}
