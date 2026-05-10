import fengari from "fengari";
import { linkedZoneMask } from "#lua/duel-api/location.js";
import { readCardUid } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardLinkApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1;
    lua.lua_pushboolean(state, Boolean(card && mutualLinkedGroupCount(session, card) >= requested));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsCoLinked"));
}

function mutualLinkedGroupCount(session: DuelSession, card: DuelCardInstance): number {
  if (card.location !== "monsterZone" || !card.faceUp || linkedZoneMask(card, session.state) === 0) return 0;
  const cardZone = 1 << card.sequence;
  const linkedZones = linkedZoneMask(card, session.state);
  return session.state.cards.filter((candidate) => candidate.controller === card.controller && candidate.location === "monsterZone" && candidate.faceUp && candidate.uid !== card.uid && ((1 << candidate.sequence) & linkedZones) !== 0 && (linkedZoneMask(candidate, session.state) & cardZone) !== 0).length;
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}
