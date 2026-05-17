import fengari from "fengari";
import { readCardUid } from "#lua/api-utils.js";
import { linkedGroupUidsForCard, linkedZoneMask } from "#lua/duel-api/location.js";
import { pushGroupTable } from "#lua/group-api.js";
import type { DuelCardInstance, DuelSession, DuelState, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardLinkedApi(L: unknown, session: DuelSession): void {
  pushBooleanGetter(L, "IsLinked", session, (card) => Boolean(card && isLinkedMonsterZoneCard(session.state, card)));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const targetPlayer = lua.lua_isnumber(state, 2) ? normalizePlayer(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushinteger(state, card ? linkedZoneMask(card, session.state, targetPlayer) : 0);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetLinkedZone"));
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
    return linkPointsTo(state, candidate, card) || linkPointsTo(state, card, candidate);
  });
}

function monsterZoneCards(state: DuelState): DuelCardInstance[] {
  return state.cards.filter((card) => card.location === "monsterZone");
}

function linkPointsTo(state: DuelState, source: DuelCardInstance, target: DuelCardInstance): boolean {
  return source.controller === target.controller && (linkedZoneMask(source, state) & (1 << target.sequence)) !== 0;
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
