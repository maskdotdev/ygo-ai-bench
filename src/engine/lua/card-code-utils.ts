import fengari from "fengari";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua } = fengari;

export function cardCodes(card: DuelCardInstance): string[] {
  const assumedCode = card.assumedProperties?.[1];
  if (assumedCode !== undefined) return [String(assumedCode)];
  return card.data.alias ? [card.code, card.data.alias] : [card.code];
}

export function listedCodes(card: DuelCardInstance): string[] {
  return [...(card.data.listedNames ?? []), ...(card.data.fitMonster ?? [])].map(String);
}

export function listedCodeSetcodes(session: DuelSession, code: string): number[] {
  return session.state.cards.find((card) => card.code === code || card.data.alias === code)?.data.setcodes ?? [];
}

export function materialCodes(card: DuelCardInstance): string[] {
  return [...(card.data.fusionMaterials ?? []), ...(card.data.synchroMaterials ? [card.data.synchroMaterials.tuner, ...card.data.synchroMaterials.nonTuners] : []), ...(card.data.xyzMaterials ?? []), ...(card.data.linkMaterials ?? []), ...(card.data.ritualMaterials ?? [])].map(String);
}

export function readRequestedCodes(L: unknown, start: number): string[] {
  const codes: string[] = [];
  for (let index = start; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) codes.push(String(lua.lua_tointeger(L, index)));
    if (lua.lua_istable(L, index)) {
      const count = lua.lua_rawlen(L, index);
      for (let luaIndex = 1; luaIndex <= count; luaIndex += 1) {
        lua.lua_rawgeti(L, index, luaIndex);
        if (lua.lua_isnumber(L, -1)) codes.push(String(lua.lua_tointeger(L, -1)));
        lua.lua_pop(L, 1);
      }
    }
  }
  return codes;
}

export function readRequestedNumbers(L: unknown, start: number): number[] {
  const values: number[] = [];
  for (let index = start; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) values.push(lua.lua_tointeger(L, index));
    if (lua.lua_istable(L, index)) {
      const count = lua.lua_rawlen(L, index);
      for (let luaIndex = 1; luaIndex <= count; luaIndex += 1) {
        lua.lua_rawgeti(L, index, luaIndex);
        if (lua.lua_isnumber(L, -1)) values.push(lua.lua_tointeger(L, -1));
        lua.lua_pop(L, 1);
      }
    }
  }
  return values;
}

export function materialSetcodes(card: DuelCardInstance): number[] {
  return card.data.materialSetcodes ?? [];
}

export function cardSetcodes(card: DuelCardInstance): number[] {
  return card.data.setcodes ?? [];
}

export function isAnimeArchetype(card: DuelCardInstance, setcodes: readonly number[], codes: readonly string[]): boolean {
  return setcodes.some((requested) => cardSetcodes(card).some((setcode) => isSetcodeMatch(requested, setcode))) || cardCodes(card).some((code) => codes.includes(code));
}

export function isSetcodeMatch(requested: number, setcode: number): boolean {
  return (setcode & 0xfff) === (requested & 0xfff) && (setcode & requested) === requested;
}
