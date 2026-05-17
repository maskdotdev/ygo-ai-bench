import fengari from "fengari";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";
import { readCardUid } from "#lua/api-utils.js";
import { pushGroupTable } from "#lua/group-api.js";

const { lua, to_luastring } = fengari;

export function installCardColumnApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const targetUid = readCardUid(state, 2);
    const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
    lua.lua_pushboolean(state, Boolean(card && target && isFieldCard(card) && isFieldCard(target) && card.controller === target.controller && card.sequence === target.sequence));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsColumn"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetColumnGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetColumnGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGetColumnZone(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetColumnZone"));
}

function pushGetColumnZone(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const locationMask = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const left = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0);
  const right = Math.max(0, lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : 0);
  lua.lua_pushinteger(L, card && isFieldCard(card) ? columnZoneMask(card, locationMask, left, right) : 0);
  return 1;
}

function pushGetColumnGroup(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const left = Math.max(0, lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0);
  const right = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 0);
  const uids =
    card && isFieldCard(card)
      ? session.state.cards.filter((candidate) => isFieldCard(candidate) && candidate.uid !== card.uid && candidate.sequence >= card.sequence - left && candidate.sequence <= card.sequence + right).map((candidate) => candidate.uid)
      : [];
  pushGroupTable(L, uids);
  return 1;
}

function columnZoneMask(card: DuelCardInstance, locationMask: number, left: number, right: number): number {
  let mask = 0;
  for (let sequence = card.sequence - left; sequence <= card.sequence + right; sequence += 1) {
    if (sequence < 0 || sequence > 4) continue;
    if ((locationMask & 0x04) !== 0) mask |= (1 << sequence) | (1 << (16 + sequence));
    if ((locationMask & 0x08) !== 0) mask |= (1 << (8 + sequence)) | (1 << (24 + sequence));
  }
  return mask;
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function isFieldCard(card: DuelCardInstance): boolean {
  return card.location === "monsterZone" || card.location === "spellTrapZone";
}
