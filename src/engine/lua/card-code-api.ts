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
    if (!card) {
      lua.lua_pushnil(state);
      return 1;
    }
    pushCardScriptTable(state, card.code);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetMetatable"));
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
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : undefined;
    lua.lua_pushboolean(state, Boolean(card && requested !== undefined && cardSetcodes(card).some((setcode) => isSetcodeMatch(requested, setcode))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsOriginalSetCard"));
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
  pushBooleanGetter(L, "IsAngel", session, (card) => Boolean(card && isAnimeArchetype(card, angelSetcodes, angelCodes)));
  pushBooleanGetter(L, "IsAtlandis", session, (card) => Boolean(card && isAnimeArchetype(card, atlandisSetcodes, atlandisCodes)));
  pushBooleanGetter(L, "IsBlackwingTamer", session, (card) => Boolean(card && isAnimeArchetype(card, blackwingTamerSetcodes, blackwingTamerCodes)));
  pushBooleanGetter(L, "IsC", session, (card) => Boolean(card && isAnimeArchetype(card, cSetcodes, cCodes)));
  pushBooleanGetter(L, "IsCicada", session, (card) => Boolean(card && isAnimeArchetype(card, cicadaSetcodes, cicadaCodes)));
  pushBooleanGetter(L, "IsDyson", session, (card) => Boolean(card && isAnimeArchetype(card, dysonSetcodes, dysonCodes)));
  pushBooleanGetter(L, "IsRed", session, (card) => Boolean(card && isAnimeArchetype(card, redSetcodes, redCodes)));
  pushBooleanGetter(L, "IsWhite", session, (card) => Boolean(card && isAnimeArchetype(card, whiteSetcodes, whiteCodes)));
  pushBooleanGetter(L, "IsChampion", session, (card) => Boolean(card && isAnimeArchetype(card, championSetcodes, championCodes)));
  pushBooleanGetter(L, "IsGoyo", session, (card) => Boolean(card && isAnimeArchetype(card, goyoSetcodes, goyoCodes)));
  pushBooleanGetter(L, "IsHeavyIndustry", session, (card) => Boolean(card && isAnimeArchetype(card, heavyIndustrySetcodes, heavyIndustryCodes)));
  pushBooleanGetter(L, "IsMantis", session, (card) => Boolean(card && isAnimeArchetype(card, mantisSetcodes, mantisCodes)));
  pushBooleanGetter(L, "IsMask", session, (card) => Boolean(card && isAnimeArchetype(card, maskSetcodes, maskCodes)));
  pushBooleanGetter(L, "IsMelodiousSongtress", session, (card) => Boolean(card && isAnimeArchetype(card, melodiousSongtressSetcodes, melodiousSongtressCodes)));
  pushBooleanGetter(L, "IsPapillon", session, (card) => Boolean(card && isAnimeArchetype(card, papillonSetcodes, papillonCodes)));
  pushBooleanGetter(L, "IsShark", session, (card) => Boolean(card && isAnimeArchetype(card, sharkSetcodes, sharkCodes)));
  pushBooleanGetter(L, "IsStarvingVenemy", session, (card) => Boolean(card && isAnimeArchetype(card, starvingVenemySetcodes, starvingVenemyCodes)));
  pushBooleanGetter(L, "IsEarth", session, (card) => Boolean(card && isAnimeArchetype(card, earthSetcodes, earthCodes)));
  pushBooleanGetter(L, "IsSky", session, (card) => Boolean(card && isAnimeArchetype(card, skySetcodes, skyCodes)));
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

function pushCardScriptTable(L: unknown, code: string): void {
  lua.lua_getglobal(L, to_luastring(`c${code}`));
  if (lua.lua_istable(L, -1)) return;
  lua.lua_pop(L, 1);
  lua.lua_newtable(L);
  lua.lua_pushvalue(L, -1);
  lua.lua_setglobal(L, to_luastring(`c${code}`));
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

function cardSetcodes(card: DuelCardInstance): number[] {
  return card.data.setcodes ?? [];
}

function isAnimeArchetype(card: DuelCardInstance, setcodes: readonly number[], codes: readonly string[]): boolean {
  return setcodes.some((requested) => cardSetcodes(card).some((setcode) => isSetcodeMatch(requested, setcode))) || cardCodes(card).some((code) => codes.includes(code));
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

const angelSetcodes = [0x154a, 0xef] as const;
const angelCodes = [
  "79575620",
  "39996157",
  "15914410",
  "53334641",
  "16972957",
  "42216237",
  "42418084",
  "18378582",
  "59509952",
  "81146288",
  "85399281",
  "47852924",
  "74137509",
  "17653779",
  "9032529",
  "79571449",
  "2130625",
  "49674183",
  "69992868",
  "96470883",
  "11398951",
  "19280589",
] as const;

const atlandisSetcodes = [0x506] as const;
const atlandisCodes = ["9161357", "6387204"] as const;

const blackwingTamerSetcodes = [0x2033] as const;
const blackwingTamerCodes = ["81983656"] as const;

const cSetcodes = [0x1048, 0x1073, 0x568] as const;
const cCodes = ["15862758"] as const;

const cicadaSetcodes = [0x50f] as const;
const cicadaCodes = ["4997565", "79663524", "5068132"] as const;

const dysonSetcodes = [0x519] as const;
const dysonCodes = ["1992816", "32559361"] as const;

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

const championSetcodes = [0x152f] as const;
const championCodes = ["82382815", "27553701"] as const;

const goyoSetcodes = [0x523] as const;
const goyoCodes = ["49785720", "59255742", "7391448", "84305651", "63364266", "58901502", "98637386"] as const;

const heavyIndustrySetcodes = [0x529] as const;
const heavyIndustryCodes = ["42851643", "29515122", "13647631"] as const;

const mantisSetcodes = [0x535] as const;
const mantisCodes = ["58818411", "31600513", "53754104"] as const;

const maskSetcodes = [0x583] as const;
const maskCodes = [
  "29549364",
  "13676474",
  "77581312",
  "48948935",
  "94377247",
  "49064413",
  "10189126",
  "82432018",
  "57882509",
  "56948373",
  "3149764",
  "16392422",
  "20765952",
  "28933734",
  "22610082",
] as const;

const melodiousSongtressSetcodes = [0x209b] as const;
const melodiousSongtressCodes = ["90276649", "14763299", "62895219", "64881644"] as const;

const papillonSetcodes = [0x53c] as const;
const papillonCodes = ["92341815", "91140491", "16366944", "8910240"] as const;

const sharkSetcodes = [0x547] as const;
const sharkCodes = [
  "7500772",
  "23672629",
  "10532969",
  "49221191",
  "7150545",
  "14306092",
  "84224627",
  "23536866",
  "32393580",
  "20838380",
  "20358953",
  "50449881",
  "71923655",
  "44223284",
  "69155991",
  "70655556",
  "63193879",
  "5014629",
  "51227866",
  "25484449",
  "64319467",
  "17643265",
  "34290067",
  "37798171",
  "37279508",
  "65676461",
  "59479050",
  "31320433",
  "17201174",
  "440556",
  "70101178",
  "87047161",
  "37792478",
  "47840168",
  "70156946",
  "11845050",
] as const;

const starvingVenemySetcodes = [0x576] as const;
const starvingVenemyCodes = ["22070401", "93729065"] as const;

const earthSetcodes = [0x51a, 0x21, 0x567] as const;
const earthCodes = [
  "42685062",
  "76052811",
  "71564150",
  "77827521",
  "75375465",
  "70595331",
  "94773007",
  "45042329",
  "22082163",
  "37970940",
  "82140600",
  "78783370",
  "99426834",
  "32360466",
  "66500065",
  "24294108",
  "28120197",
  "62966332",
  "67494157",
  "46372010",
  "48934760",
  "88696724",
  "59820352",
  "67105242",
  "29934351",
  "60866277",
  "54407825",
  "66788016",
  "53778229",
  "46181000",
  "14258627",
  "67113830",
  "61468779",
  "15545291",
  "60229110",
  "90502999",
  "33970665",
  "35762283",
  "12247206",
  "54109233",
  "9628664",
  "79109599",
  "95993388",
  "54976796",
  "3136426",
  "64681263",
  "97612389",
  "86016245",
  "91020571",
  "58601383",
  "97204936",
  "63465535",
  "4587638",
  "38296564",
  "60627999",
  "79569173",
  "97169186",
  "26381750",
  "70156997",
  "20590784",
  "77428945",
  "54762426",
  "46918794",
  "95220856",
  "2084239",
  "77754944",
  "7443908",
  "4997565",
  "36029076",
  "46820049",
  "50916353",
  "64104037",
  "99370594",
  "61103515",
] as const;

const skySetcodes = [0x54a, 0xf6, 0x3042, 0x254a, 0x154a, 0xef] as const;
const skyCodes = [
  "49771608",
  "42431843",
  "67443336",
  "32360466",
  "50323155",
  "3072808",
  "87390067",
  "22346472",
  "42664989",
  "54977057",
  "62966332",
  "77998771",
  "77235086",
  "3629090",
  "49010598",
  "54407825",
  "95457011",
  "96570609",
  "92223641",
  "4149689",
  "1637760",
  "39238953",
  "38411870",
  "7452945",
  "97795930",
  "10028593",
  "86327225",
  "27813661",
  "11458071",
  "48453776",
  "74841885",
  "10000020",
  "41589166",
  "90122655",
  "95352218",
  "23587624",
  "29146185",
  "37910722",
  "32995007",
  "75326861",
  "58601383",
  "1992816",
  "80764541",
  "23085002",
  "32559361",
  "2519690",
  "12171659",
  "80196387",
  "33837653",
  "60822251",
  "64806765",
  "33907039",
  "69865139",
  "25472513",
  "79575620",
  "39996157",
  "15914410",
  "53334641",
  "16972957",
  "42216237",
  "42418084",
  "18378582",
  "59509952",
  "81146288",
  "85399281",
  "47852924",
  "74137509",
  "17653779",
  "9032529",
  "79571449",
  "2130625",
  "49674183",
  "69992868",
  "96470883",
  "11398951",
  "19280589",
] as const;
