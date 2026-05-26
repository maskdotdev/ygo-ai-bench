import fengari from "fengari";
import { hasZoneSpace } from "#duel/card-state.js";
import { isControlChangePrevented } from "#duel/continuous-effects.js";
import { availableForcedMonsterZoneCount } from "#duel/forced-monster-zones.js";
import { readCardUid } from "#lua/api-utils.js";
import { createLuaMaterialCheckContext } from "#lua/card-effect-query-api.js";
import { readRequestedNumbers } from "#lua/card-code-utils.js";
import type { DuelCardInstance, DuelSession, DuelState, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;
const locationReasonControl = 0x2;

export function installCardControlApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedPlayers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && requested.includes(card.controller)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsControler"));
  pushCanChangeControler(L, "IsAbleToChangeControler", session);
  pushCanChangeControler(L, "IsControlerCanBeChanged", session);
}

function pushCanChangeControler(L: unknown, fieldName: string, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const targetPlayer = lua.lua_isnumber(state, 2) ? normalizePlayer(lua.lua_tointeger(state, 2)) : card ? otherPlayer(card.controller) : undefined;
    const ignoreMonsterZoneAvailability = lua.lua_isboolean(state, 2) && lua.lua_toboolean(state, 2);
    lua.lua_pushboolean(state, Boolean(card && targetPlayer !== undefined && canChangeControl(session.state, card, targetPlayer, ignoreMonsterZoneAvailability)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function canChangeControl(state: DuelState, card: DuelCardInstance, targetPlayer: PlayerId, ignoreMonsterZoneAvailability = false): boolean {
  if (card.controller === targetPlayer) return false;
  if (card.location !== "monsterZone" && card.location !== "spellTrapZone") return false;
  if (isControlChangePrevented(state, card, createLuaMaterialCheckContext(state))) return false;
  if (card.location === "monsterZone") return ignoreMonsterZoneAvailability || availableForcedMonsterZoneCount(state, targetPlayer, [card.uid], 0, locationReasonControl, card) > 0;
  return hasZoneSpace(state, targetPlayer, card.location);
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function readRequestedPlayers(L: unknown, startIndex: number): PlayerId[] {
  return readRequestedNumbers(L, startIndex).map(normalizePlayer);
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
