import fengari from "fengari";
import { locationsFromMask, readCardUid, readGroupUids } from "#lua/api-utils.js";
import type { DuelLocation, PlayerId } from "#duel/types.js";

const { lua } = fengari;

export function readMoveReason(L: unknown, index: number, extraReason: number): number | undefined {
  const reason = lua.lua_isnumber(L, index) ? lua.lua_tointeger(L, index) : undefined;
  if (reason === undefined && extraReason === 0) return undefined;
  return (reason ?? 0) | extraReason;
}

export function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

export function readOptionalPlayer(L: unknown, index: number): PlayerId | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const value = lua.lua_tointeger(L, index);
  if (value !== 0 && value !== 1) return undefined;
  return value;
}

export function readFieldDestination(L: unknown, index: number): "monsterZone" | "spellTrapZone" | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const locations = locationsFromMask(lua.lua_tointeger(L, index));
  if (locations.includes("monsterZone")) return "monsterZone";
  if (locations.includes("spellTrapZone")) return "spellTrapZone";
  return undefined;
}

export function readSingleDestination(L: unknown, index: number): DuelLocation | undefined {
  if (!lua.lua_isnumber(L, index)) return undefined;
  const mask = lua.lua_tointeger(L, index);
  if ((mask & 0x40) !== 0) return "extraDeck";
  if ((mask & 0x20) !== 0) return "banished";
  if ((mask & 0x10) !== 0) return "graveyard";
  if ((mask & 0x08) !== 0) return "spellTrapZone";
  if ((mask & 0x04) !== 0) return "monsterZone";
  if ((mask & 0x02) !== 0) return "hand";
  if ((mask & 0x01) !== 0) return "deck";
  return undefined;
}
