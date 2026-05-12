import fengari from "fengari";
import type { CardPosition, DuelCardInstance, DuelLocation } from "#duel/types.js";

const { lua, lauxlib, to_luastring } = fengari;

export function copyGlobalFunctionToField(L: unknown, tableName: string, fieldName: string): void {
  lua.lua_getglobal(L, to_luastring(tableName));
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  lua.lua_setfield(L, -3, to_luastring(fieldName));
  lua.lua_pop(L, 1);
}

export function readTableStringField(L: unknown, index: number, fieldName: string): string | undefined {
  lua.lua_getfield(L, index, to_luastring(fieldName));
  const value = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

export function readTableNumberField(L: unknown, index: number, fieldName: string): number | undefined {
  lua.lua_getfield(L, index, to_luastring(fieldName));
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value;
}

export function readCardUid(L: unknown, index: number): string | undefined {
  if (!lua.lua_istable(L, index)) return undefined;
  return readTableStringField(L, index, "__duel_uid");
}

export function readGroupUids(L: unknown, index: number): string[] {
  if (!lua.lua_istable(L, index)) return [];
  lua.lua_getfield(L, index, to_luastring("__group_uids"));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return [];
  }
  const count = lua.lua_rawlen(L, -1);
  const uids: string[] = [];
  for (let luaIndex = 1; luaIndex <= count; luaIndex += 1) {
    lua.lua_rawgeti(L, -1, luaIndex);
    const uid = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : undefined;
    if (uid) uids.push(uid);
    lua.lua_pop(L, 1);
  }
  lua.lua_pop(L, 1);
  return uids;
}

export function setGroupUids(L: unknown, index: number, uids: string[]): void {
  lua.lua_newtable(L);
  for (const [luaIndex, uid] of uids.entries()) {
    lua.lua_pushliteral(L, uid);
    lua.lua_rawseti(L, -2, luaIndex + 1);
  }
  lua.lua_setfield(L, index, to_luastring("__group_uids"));
}

export function readOptionalFunctionRef(L: unknown, index: number): number | undefined {
  if (!lua.lua_isfunction(L, index)) return undefined;
  lua.lua_pushvalue(L, index);
  return lauxlib.luaL_ref(L, lua.LUA_REGISTRYINDEX);
}

export function releaseOptionalFunctionRef(L: unknown, ref: number | undefined): void {
  if (ref !== undefined) lauxlib.luaL_unref(L, lua.LUA_REGISTRYINDEX, ref);
}

export function locationsFromMask(mask: number): DuelLocation[] {
  const locations: DuelLocation[] = [];
  if ((mask & 0x01) !== 0) locations.push("deck");
  if ((mask & 0x02) !== 0) locations.push("hand");
  if ((mask & 0x04) !== 0) locations.push("monsterZone");
  if ((mask & 0x08) !== 0) locations.push("spellTrapZone");
  if ((mask & 0x10) !== 0) locations.push("graveyard");
  if ((mask & 0x20) !== 0) locations.push("banished");
  if ((mask & 0x40) !== 0) locations.push("extraDeck");
  if ((mask & 0x80) !== 0) locations.push("overlay");
  if ((mask & 0x100) !== 0) locations.push("spellTrapZone");
  if ((mask & 0x200) !== 0) locations.push("spellTrapZone");
  if ((mask & 0x400) !== 0) locations.push("spellTrapZone");
  if ((mask & 0x800) !== 0) locations.push("monsterZone");
  if ((mask & 0x1000) !== 0) locations.push("monsterZone");
  return locations;
}

export function locationMatchesMask(location: DuelLocation | undefined, sequence: number | undefined, mask: number): boolean {
  if (!location) return false;
  if ((mask & locationMaskFromLocation(location)) !== 0) return true;
  if ((mask & 0x400) !== 0 && location === "spellTrapZone") return true;
  if ((mask & 0x800) !== 0 && location === "monsterZone" && sequence !== undefined && sequence >= 0 && sequence <= 4) return true;
  return (mask & 0x1000) !== 0 && location === "monsterZone" && sequence !== undefined && sequence >= 5 && sequence <= 6;
}

export function locationMatchesCardMask(card: DuelCardInstance | undefined, mask: number, location = card?.location, sequence = card?.sequence): boolean {
  if (!card || !location) return false;
  const symbolicBits = 0x100 | 0x200 | 0x400 | 0x800 | 0x1000;
  const symbolic = symbolicLocationMask(card, location, sequence);
  if (symbolic !== 0 && (mask & symbolicBits & symbolic) !== 0) return true;
  const rawMask = mask & ~symbolicBits;
  return rawMask !== 0 && locationMatchesMask(location, sequence, rawMask);
}

export function symbolicLocationMask(card: DuelCardInstance | undefined, location = card?.location, sequence = card?.sequence): number {
  if (!card || !location) return 0;
  if (location === "spellTrapZone") {
    if (isFieldSpell(card)) return 0x100;
    if (isPendulumZoneCard(card, sequence)) return 0x200;
    return 0x400;
  }
  if (location === "monsterZone" && sequence !== undefined) return sequence >= 5 ? 0x1000 : 0x800;
  return locationMaskFromLocation(location);
}

function isFieldSpell(card: DuelCardInstance): boolean {
  return card.kind === "spell" && ((card.data.typeFlags ?? 0) & 0x80000) !== 0;
}

function isPendulumZoneCard(card: DuelCardInstance, sequence: number | undefined): boolean {
  return sequence !== undefined && sequence >= 0 && sequence <= 1 && ((card.data.typeFlags ?? 0) & 0x1000000) !== 0;
}

function locationMaskFromLocation(location: DuelLocation): number {
  if (location === "deck") return 0x01;
  if (location === "hand") return 0x02;
  if (location === "monsterZone") return 0x04;
  if (location === "spellTrapZone") return 0x08;
  if (location === "graveyard") return 0x10;
  if (location === "banished") return 0x20;
  if (location === "extraDeck") return 0x40;
  if (location === "overlay") return 0x80;
  return 0;
}

export function positionFromMask(mask: number): CardPosition | undefined {
  if ((mask & 0x1) !== 0) return "faceUpAttack";
  if ((mask & 0x4) !== 0) return "faceUpDefense";
  if ((mask & 0x8) !== 0) return "faceDownDefense";
  return undefined;
}

export function positionMaskFromPosition(position: CardPosition | undefined): number {
  if (position === "faceUpAttack") return 0x1;
  if (position === "faceUpDefense") return 0x4;
  if (position === "faceDown") return 0x0a;
  if (position === "faceDownDefense") return 0x8;
  return 0x1;
}
