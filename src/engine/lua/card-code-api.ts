import fengari from "fengari";
import { readCardUid, readTableStringField } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardCodeApi(L: unknown, session: DuelSession): void {
  pushNumberGetter(L, "GetCode", session, (card) => (card ? Number(card.code) : 0));
  pushNumberGetter(L, "GetOriginalCode", session, (card) => (card ? Number(card.code) : 0));
  pushNumberGetter(L, "GetOriginalCodeRule", session, (card) => (card ? Number(card.code) : 0));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && cardCodes(card).includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && !cardCodes(card).includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsNotCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    lua.lua_pushboolean(state, Boolean(card && listedCodes(card).some((code) => readRequestedCodes(state, 2).includes(code))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ListsCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    lua.lua_pushboolean(state, Boolean(card && materialCodes(card).some((code) => readRequestedCodes(state, 2).includes(code))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ListsCodeAsMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    lua.lua_pushboolean(state, Boolean(card && materialSetcodes(card).some((setcode) => readRequestedNumbers(state, 2).some((requested) => isSetcodeMatch(requested, setcode)))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ListsArchetypeAsMaterial"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && card.code === requested));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsOriginalCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? String(lua.lua_tointeger(state, 2)) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested && card.code === requested));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsOriginalCodeRule"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const firstCodeIndex = lua.lua_isnumber(state, 4) ? 4 : 2;
    lua.lua_pushboolean(state, Boolean(card && matchesAnyCodeAtOrAfter(state, card, firstCodeIndex)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSummonCode"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested !== undefined && card.data.setcodes?.includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsSetCard"));
  pushNumberGetter(L, "GetSetCard", session, (card) => card?.data.setcodes?.[0] ?? 0);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested !== undefined && !card.data.setcodes?.includes(requested)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsNotSetCard"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    lua.lua_pushboolean(state, Boolean(card && cardCodes(card).includes("1378")));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsInfinity"));
  pushBooleanGetter(L, "IsRed", session, (card) => Boolean(card && isAnimeArchetype(card, redSetcodes, redCodes)));
  pushBooleanGetter(L, "IsWhite", session, (card) => Boolean(card && isAnimeArchetype(card, whiteSetcodes, whiteCodes)));
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

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1) ?? readTableStringField(L, 1, "__duel_uid");
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function cardCodes(card: DuelCardInstance): string[] {
  return card.data.alias ? [card.code, card.data.alias] : [card.code];
}

function listedCodes(card: DuelCardInstance): string[] {
  return [...(card.data.listedNames ?? []), ...(card.data.fitMonster ?? [])].map(String);
}

function materialCodes(card: DuelCardInstance): string[] {
  return [...(card.data.fusionMaterials ?? []), ...(card.data.synchroMaterials ? [card.data.synchroMaterials.tuner, ...card.data.synchroMaterials.nonTuners] : []), ...(card.data.xyzMaterials ?? []), ...(card.data.linkMaterials ?? []), ...(card.data.ritualMaterials ?? [])].map(String);
}

function readRequestedCodes(L: unknown, start: number): string[] {
  const codes: string[] = [];
  for (let index = start; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) codes.push(String(lua.lua_tointeger(L, index)));
  }
  return codes;
}

function readRequestedNumbers(L: unknown, start: number): number[] {
  const values: number[] = [];
  for (let index = start; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index)) values.push(lua.lua_tointeger(L, index));
  }
  return values;
}

function materialSetcodes(card: DuelCardInstance): number[] {
  return card.data.materialSetcodes ?? [];
}

function isAnimeArchetype(card: DuelCardInstance, setcodes: readonly number[], codes: readonly string[]): boolean {
  const cardSetcodes = card.data.setcodes ?? [];
  return setcodes.some((requested) => cardSetcodes.some((setcode) => isSetcodeMatch(requested, setcode))) || cardCodes(card).some((code) => codes.includes(code));
}

function isSetcodeMatch(requested: number, setcode: number): boolean {
  return (setcode & 0xfff) === (requested & 0xfff) && (setcode & requested) === requested;
}

function matchesAnyCodeAtOrAfter(L: unknown, card: DuelCardInstance, start: number): boolean {
  const codes = cardCodes(card);
  for (let index = start; index <= lua.lua_gettop(L); index += 1) {
    if (lua.lua_isnumber(L, index) && codes.includes(String(lua.lua_tointeger(L, index)))) return true;
  }
  return false;
}

const redSetcodes = [0x543, 0x3b, 0x1045] as const;
const redCodes = [
  "71279983",
  "6917479",
  "63813056",
  "35787450",
  "37132349",
  "55888045",
  "34475451",
  "62180201",
  "41197012",
  "2542230",
  "99585850",
  "97489701",
  "8372133",
  "5376159",
  "18634367",
  "30979619",
  "59057152",
  "45462639",
  "59975920",
  "40591390",
  "36625827",
  "51925772",
  "8387138",
  "45313993",
  "38035986",
  "86445415",
  "72318602",
  "14531242",
  "14886469",
  "50584941",
  "61019812",
  "56789759",
  "14618326",
  "21142671",
  "38199696",
  "8706701",
  "66141736",
  "40975574",
  "23002292",
  "70628672",
  "26118970",
  "76547525",
  "19025379",
  "95453143",
] as const;

const whiteSetcodes = [0x55d] as const;
const whiteCodes = [
  "13429800",
  "46104361",
  "9433350",
  "32269855",
  "22804410",
  "73398797",
  "24644634",
  "79473793",
  "38517737",
  "89631139",
  "71039903",
  "79814787",
  "78229193",
  "89907227",
  "5614808",
  "63731062",
  "63509474",
  "15150365",
  "49930315",
  "3557275",
  "92409659",
  "20193924",
  "1571945",
  "62487836",
  "43487744",
  "73891874",
  "98024118",
  "84812868",
  "32825095",
  "84335863",
  "19885332",
  "52596406",
  "98684051",
  "46956301",
  "21579049",
  "57964143",
] as const;
