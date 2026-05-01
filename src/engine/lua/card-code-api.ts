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
    const requested = readRequestedNumbers(state, 2);
    lua.lua_pushboolean(state, Boolean(card && listedCodes(card).some((code) => listedCodeSetcodes(session, code).some((setcode) => requested.some((wanted) => isSetcodeMatch(wanted, setcode))))));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("ListsCodeWithArchetype"));
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
  pushBooleanGetter(L, "IsAlligator", session, (card) => Boolean(card && isAnimeArchetype(card, alligatorSetcodes, alligatorCodes)));
  pushBooleanGetter(L, "IsAngel", session, (card) => Boolean(card && isAnimeArchetype(card, angelSetcodes, angelCodes)));
  pushBooleanGetter(L, "IsAncientGearGolem", session, (card) => Boolean(card && isAnimeArchetype(card, ancientGearGolemSetcodes, ancientGearGolemCodes)));
  pushBooleanGetter(L, "IsAnti", session, (card) => Boolean(card && isAnimeArchetype(card, antiSetcodes, antiCodes)));
  pushBooleanGetter(L, "IsAssassin", session, (card) => Boolean(card && isAnimeArchetype(card, assassinSetcodes, assassinCodes)));
  pushBooleanGetter(L, "IsAstral", session, (card) => Boolean(card && isAnimeArchetype(card, astralSetcodes, astralCodes)));
  pushBooleanGetter(L, "IsAtlandis", session, (card) => Boolean(card && isAnimeArchetype(card, atlandisSetcodes, atlandisCodes)));
  pushBooleanGetter(L, "IsBlackwingTamer", session, (card) => Boolean(card && isAnimeArchetype(card, blackwingTamerSetcodes, blackwingTamerCodes)));
  pushBooleanGetter(L, "IsButterfly", session, (card) => Boolean(card && isAnimeArchetype(card, butterflySetcodes, butterflyCodes)));
  pushBooleanGetter(L, "IsC", session, (card) => Boolean(card && isAnimeArchetype(card, cSetcodes, cCodes)));
  pushBooleanGetter(L, "IsCat", session, (card) => Boolean(card && isAnimeArchetype(card, catSetcodes, catCodes)));
  pushBooleanGetter(L, "IsCelestial", session, (card) => Boolean(card && isAnimeArchetype(card, celestialSetcodes, celestialCodes)));
  pushBooleanGetter(L, "IsCenozoic", session, (card) => Boolean(card && isAnimeArchetype(card, cenozoicSetcodes, cenozoicCodes)));
  pushBooleanGetter(L, "IsCicada", session, (card) => Boolean(card && isAnimeArchetype(card, cicadaSetcodes, cicadaCodes)));
  pushBooleanGetter(L, "IsClear", session, (card) => Boolean(card && isAnimeArchetype(card, clearSetcodes, clearCodes)));
  pushBooleanGetter(L, "IsCN39UtopiaRay", session, (card) => Boolean(card && isAnimeArchetype(card, cn39UtopiaRaySetcodes, cn39UtopiaRayCodes)));
  pushBooleanGetter(L, "IsComicsHero", session, (card) => Boolean(card && isAnimeArchetype(card, comicsHeroSetcodes, comicsHeroCodes)));
  pushBooleanGetter(L, "IsCubicSeed", session, (card) => Boolean(card && isAnimeArchetype(card, cubicSeedSetcodes, cubicSeedCodes)));
  pushBooleanGetter(L, "IsDarkness", session, (card) => Boolean(card && isAnimeArchetype(card, darknessSetcodes, darknessCodes)));
  pushBooleanGetter(L, "IsDart", session, (card) => Boolean(card && isAnimeArchetype(card, dartSetcodes, dartCodes)));
  pushBooleanGetter(L, "IsDice", session, (card) => Boolean(card && isAnimeArchetype(card, diceSetcodes, diceCodes)));
  pushBooleanGetter(L, "IsDog", session, (card) => Boolean(card && isAnimeArchetype(card, dogSetcodes, dogCodes)));
  pushBooleanGetter(L, "IsDoll", session, (card) => Boolean(card && isAnimeArchetype(card, dollSetcodes, dollCodes)));
  pushBooleanGetter(L, "IsDruid", session, (card) => Boolean(card && isAnimeArchetype(card, druidSetcodes, druidCodes)));
  pushBooleanGetter(L, "IsDyson", session, (card) => Boolean(card && isAnimeArchetype(card, dysonSetcodes, dysonCodes)));
  pushBooleanGetter(L, "IsEarthboundServant", session, (card) => Boolean(card && isAnimeArchetype(card, earthboundServantSetcodes, earthboundServantCodes)));
  pushBooleanGetter(L, "IsElf", session, (card) => Boolean(card && isAnimeArchetype(card, elfSetcodes, elfCodes)));
  pushBooleanGetter(L, "IsEmissaryOfDarkness", session, (card) => Boolean(card && isAnimeArchetype(card, emissaryOfDarknessSetcodes, emissaryOfDarknessCodes)));
  pushBooleanGetter(L, "IsFairy", session, (card) => Boolean(card && isAnimeArchetype(card, fairySetcodes, fairyCodes)));
  pushBooleanGetter(L, "IsForest", session, (card) => Boolean(card && isAnimeArchetype(card, forestSetcodes, forestCodes)));
  pushBooleanGetter(L, "IsFortressWhale", session, (card) => Boolean(card && isAnimeArchetype(card, fortressWhaleSetcodes, fortressWhaleCodes)));
  pushBooleanGetter(L, "IsGaiatheDragonChampion", session, (card) => Boolean(card && isAnimeArchetype(card, gaiaTheDragonChampionSetcodes, gaiaTheDragonChampionCodes)));
  pushBooleanGetter(L, "IsGemKnightLady", session, (card) => Boolean(card && isAnimeArchetype(card, gemKnightLadySetcodes, gemKnightLadyCodes)));
  pushBooleanGetter(L, "IsGorgonic", session, (card) => Boolean(card && isAnimeArchetype(card, gorgonicSetcodes, gorgonicCodes)));
  pushBooleanGetter(L, "IsGranel", session, (card) => Boolean(card && isAnimeArchetype(card, granelSetcodes, granelCodes)));
  pushBooleanGetter(L, "IsRed", session, (card) => Boolean(card && isAnimeArchetype(card, redSetcodes, redCodes)));
  pushBooleanGetter(L, "IsWhite", session, (card) => Boolean(card && isAnimeArchetype(card, whiteSetcodes, whiteCodes)));
  pushBooleanGetter(L, "IsChampion", session, (card) => Boolean(card && isAnimeArchetype(card, championSetcodes, championCodes)));
  pushBooleanGetter(L, "IsGoyo", session, (card) => Boolean(card && isAnimeArchetype(card, goyoSetcodes, goyoCodes)));
  pushBooleanGetter(L, "IsHand", session, (card) => Boolean(card && isAnimeArchetype(card, handSetcodes, handCodes)));
  pushBooleanGetter(L, "IsHarpieLadySisters", session, (card) => Boolean(card && isAnimeArchetype(card, harpieLadySistersSetcodes, harpieLadySistersCodes)));
  pushBooleanGetter(L, "IsHelios", session, (card) => Boolean(card && isAnimeArchetype(card, [], heliosCodes)));
  pushBooleanGetter(L, "IsHell", session, (card) => Boolean(card && isAnimeArchetype(card, hellSetcodes, hellCodes)));
  pushBooleanGetter(L, "IsHeraldic", session, (card) => Boolean(card && isAnimeArchetype(card, heraldicSetcodes, heraldicCodes)));
  pushBooleanGetter(L, "IsHeavyIndustry", session, (card) => Boolean(card && isAnimeArchetype(card, heavyIndustrySetcodes, heavyIndustryCodes)));
  pushBooleanGetter(L, "IsHunder", session, (card) => Boolean(card && isAnimeArchetype(card, hunderSetcodes, hunderCodes)));
  pushBooleanGetter(L, "IsInsectQueen", session, (card) => Boolean(card && isAnimeArchetype(card, insectQueenSetcodes, insectQueenCodes)));
  pushBooleanGetter(L, "IsInu", session, (card) => Boolean(card && isAnimeArchetype(card, inuSetcodes, inuCodes)));
  pushBooleanGetter(L, "IsIvy", session, (card) => Boolean(card && isAnimeArchetype(card, ivySetcodes, ivyCodes)));
  pushBooleanGetter(L, "IsJester", session, (card) => Boolean(card && isAnimeArchetype(card, jesterSetcodes, jesterCodes)));
  pushBooleanGetter(L, "IsJutte", session, (card) => Boolean(card && isAnimeArchetype(card, jutteSetcodes, jutteCodes)));
  pushBooleanGetter(L, "IsMantis", session, (card) => Boolean(card && isAnimeArchetype(card, mantisSetcodes, mantisCodes)));
  pushBooleanGetter(L, "IsMask", session, (card) => Boolean(card && isAnimeArchetype(card, maskSetcodes, maskCodes)));
  pushBooleanGetter(L, "IsMelodiousSongtress", session, (card) => Boolean(card && isAnimeArchetype(card, melodiousSongtressSetcodes, melodiousSongtressCodes)));
  pushBooleanGetter(L, "IsPapillon", session, (card) => Boolean(card && isAnimeArchetype(card, papillonSetcodes, papillonCodes)));
  pushBooleanGetter(L, "IsShark", session, (card) => Boolean(card && isAnimeArchetype(card, sharkSetcodes, sharkCodes)));
  pushBooleanGetter(L, "IsStarvingVenemy", session, (card) => Boolean(card && isAnimeArchetype(card, starvingVenemySetcodes, starvingVenemyCodes)));
  pushBooleanGetter(L, "IsEarth", session, (card) => Boolean(card && isAnimeArchetype(card, earthSetcodes, earthCodes) && !isAnimeArchetype(card, hellSetcodes, hellCodes)));
  pushBooleanGetter(L, "IsSky", session, (card) => Boolean(card && isAnimeArchetype(card, skySetcodes, skyCodes)));
  pushBooleanGetter(L, "Is_V_", session, (card) => Boolean(card && isAnimeArchetype(card, vZexalSetcodes, vZexalCodes)));
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

function listedCodeSetcodes(session: DuelSession, code: string): number[] {
  return session.state.cards.find((card) => card.code === code || card.data.alias === code)?.data.setcodes ?? [];
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

const alligatorSetcodes = [0x502] as const;
const alligatorCodes = ["39984786", "4611269", "34479658", "59383041", "66451379"] as const;

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

const ancientGearGolemSetcodes = [0x581] as const;
const ancientGearGolemCodes = ["83104731", "95735217", "7171149", "12652643"] as const;
const antiSetcodes = [0x503] as const;
const antiCodes = ["43583400", "31683874", "52085072", "59839761"] as const;
const assassinSetcodes = [0x504] as const;
const assassinCodes = ["48365709", "19357125", "16226786", "2191144", "25262697", "28150174", "77558536"] as const;
const astralSetcodes = [0x505] as const;
const astralCodes = ["64591429", "37053871", "69852487", "45950291"] as const;

const atlandisSetcodes = [0x506] as const;
const atlandisCodes = ["9161357", "6387204"] as const;

const blackwingTamerSetcodes = [0x2033] as const;
const blackwingTamerCodes = ["81983656"] as const;

const butterflySetcodes = [0x50c, 0x150c, 0x6a] as const;
const butterflyCodes = ["16984449", "69243953", "57261568", "3966653", "63630268"] as const;

const cSetcodes = [0x1048, 0x1073, 0x568] as const;
const cCodes = ["15862758"] as const;

const catSetcodes = [0x50e] as const;
const catCodes = [
  "19963185",
  "74148483",
  "28981598",
  "54191698",
  "70975131",
  "84224627",
  "43352213",
  "88032456",
  "2729285",
  "22953211",
  "32933942",
  "5506791",
  "25531465",
  "96501677",
  "51777272",
  "11439455",
  "14878871",
  "52346240",
] as const;

const celestialSetcodes = [0x254a] as const;
const celestialCodes = ["69865139", "25472513"] as const;

const cenozoicSetcodes = [0x57c] as const;
const cenozoicCodes = ["12015000", "10040267", "86520461"] as const;

const cicadaSetcodes = [0x50f] as const;
const cicadaCodes = ["4997565", "79663524", "5068132"] as const;

const clearSetcodes = [0x510] as const;
const clearCodes = ["97811903", "82044279", "33900648", "6089145", "33506331", "70717628", "7102732", "70095046"] as const;

const cn39UtopiaRaySetcodes = [0x1539] as const;
const cn39UtopiaRayCodes = ["56840427", "87911394", "66970002"] as const;

const comicsHeroSetcodes = [0x511] as const;
const comicsHeroCodes = ["77631175", "13030280"] as const;

const cubicSeedSetcodes = [0x10e3] as const;
const cubicSeedCodes = ["15610297"] as const;

const darknessSetcodes = [0x316] as const;
const darknessCodes = [
  "18967507",
  "79266769",
  "31571902",
  "22586618",
  "86229493",
  "93709215",
  "60417395",
  "73018302",
  "18897163",
  "6764709",
  "47297616",
  "19652159",
  "96561011",
  "88264978",
] as const;

const dartSetcodes = [0x513] as const;
const dartCodes = ["43061293"] as const;

const diceSetcodes = [0x514] as const;
const diceCodes = ["16725505", "27660735", "69893315", "59905358", "3549275", "88482761", "83241722"] as const;

const dogSetcodes = [0x516] as const;
const dogCodes = [
  "72714226",
  "79182538",
  "42878636",
  "34379489",
  "15475415",
  "57346400",
  "29491334",
  "25273572",
  "86652646",
  "65479980",
  "12076263",
  "96930127",
  "32349062",
  "11987744",
  "86889202",
  "39246582",
  "23297235",
  "6480253",
  "47929865",
  "94667532",
] as const;

const dollSetcodes = [0x517, 0x9d, 0x15c] as const;
const dollCodes = [
  "85639257",
  "2903036",
  "20590515",
  "72657739",
  "97520532",
  "7593748",
  "92418590",
  "79086452",
  "63825486",
  "39806198",
  "12678601",
  "53303460",
  "49563947",
  "11449436",
  "91939608",
  "82579942",
] as const;

const druidSetcodes = [0x8c] as const;
const druidCodes = ["24062258", "97064649", "6637331", "7183277"] as const;

const dysonSetcodes = [0x519] as const;
const dysonCodes = ["1992816", "32559361"] as const;

const earthboundServantSetcodes = [0x2021] as const;
const earthboundServantCodes = ["8690387", "33202303", "44094981", "45716579", "71101678"] as const;

const elfSetcodes = [0x51b, 0xe4] as const;
const elfCodes = [
  "44663232",
  "98582704",
  "39897277",
  "93221206",
  "97170107",
  "85239662",
  "68625727",
  "59983499",
  "21417692",
  "69140098",
  "42386471",
  "61807040",
  "11613567",
  "15025844",
  "98299011",
] as const;

const emissaryOfDarknessSetcodes = [0x51c] as const;
const emissaryOfDarknessCodes = ["44330098", "44330099"] as const;

const fairySetcodes = [0x51d] as const;
const fairyCodes = [
  "25862681",
  "23454876",
  "1761063",
  "90925163",
  "48742406",
  "51960178",
  "86937530",
  "55623480",
  "52022648",
  "42921475",
  "20315854",
  "45939611",
  "6979239",
] as const;

const forestSetcodes = [0x51f] as const;
const forestCodes = ["77797992", "87624166", "14015067", "4192696", "87430998", "46668237", "60398723", "37322745", "36318200", "24096499", "78010363", "42883273", "65303664", "17733394"] as const;
const fortressWhaleSetcodes = [0x583] as const;
const fortressWhaleCodes = ["62337487", "77454922", "96546575"] as const;
const gaiaTheDragonChampionSetcodes = [0x580] as const;
const gaiaTheDragonChampionCodes = ["66889139", "2519690"] as const;
const gemKnightLadySetcodes = [0x3047] as const;
const gemKnightLadyCodes = ["47611119", "19355597", "55610199"] as const;
const gorgonicSetcodes = [0x522] as const;
const gorgonicCodes = ["64379261", "84401683", "37984162", "37168514", "90764875"] as const;
const granelSetcodes = [0x524] as const;
const granelCodes = ["2137678", "4545683"] as const;
const handSetcodes = [0x527] as const;
const handCodes = ["95929069", "40830387", "20403123", "55888045", "19642889", "33453260", "97570038", "28003512", "63746411", "40555959", "68535320", "21414674", "22530212", "13317419", "95453143", "47840168", "11845050"] as const;
const harpieLadySistersSetcodes = [0x1064] as const;
const harpieLadySistersCodes = ["12206212"] as const;
const heliosCodes = ["54493213", "80887952", "17286057", "51043053", "160214029"] as const;
const hellSetcodes = [0x567] as const;
const hellCodes = ["36029076", "46820049", "50916353", "64104037", "99370594", "61103515"] as const;
const heraldicSetcodes = [0x566, 0x76] as const;
const heraldicCodes = ["23649496", "47387961"] as const;
const hunderSetcodes = [0x565] as const;
const hunderCodes = ["71438011", "78663366", "21524779", "84530620", "27217742", "57019473", "34961968", "15510988", "69196160", "20264508", "48049769", "31786629", "52833089", "50920465", "14089428", "21817254", "48770333", "61204971", "30010480", "698785", "77506119", "54752875", "6766208", "987311", "84417082", "4178474", "11741041", "12580477"] as const;
const insectQueenSetcodes = [0x582] as const;
const insectQueenCodes = ["91512835", "41456841"] as const;
const inuSetcodes = [0x52a] as const;
const inuCodes = ["79182538", "42878636", "55351724", "91754175", "86652646", "65938950", "11987744", "86889202", "27971137", "58616392", "11548522", "71583486", "94667532", "27750191"] as const;
const ivySetcodes = [0x52b] as const;
const ivyCodes = ["30069398", "14730606", "30069399"] as const;
const jesterSetcodes = [0x52c] as const;
const jesterCodes = ["94703021", "72992744", "8487449", "88722973"] as const;
const jutteSetcodes = [0x52d] as const;
const jutteCodes = ["60410769"] as const;

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
const vZexalSetcodes = [0x155a] as const;
const vZexalCodes = ["33725002", "66970002", "13536606", "13536607", "94933468"] as const;

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
