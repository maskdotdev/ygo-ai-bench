import fengari from "fengari";
import { readCardUid, readTableStringField } from "#lua/api-utils.js";
import { isAnimeArchetype } from "#lua/card-code-utils.js";
import * as animeData from "#lua/card-code-anime-data.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardCodeAnimeApi(L: unknown, session: DuelSession): void {
  pushBooleanGetter(L, "IsAlligator", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.alligatorSetcodes, animeData.alligatorCodes)));
  pushBooleanGetter(L, "IsAngel", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.angelSetcodes, animeData.angelCodes)));
  pushBooleanGetter(L, "IsAncientGearGolem", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.ancientGearGolemSetcodes, animeData.ancientGearGolemCodes)));
  pushBooleanGetter(L, "IsAnti", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.antiSetcodes, animeData.antiCodes)));
  pushBooleanGetter(L, "IsAssassin", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.assassinSetcodes, animeData.assassinCodes)));
  pushBooleanGetter(L, "IsAstral", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.astralSetcodes, animeData.astralCodes)));
  pushBooleanGetter(L, "IsAtlandis", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.atlandisSetcodes, animeData.atlandisCodes)));
  pushBooleanGetter(L, "IsBlackwingTamer", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.blackwingTamerSetcodes, animeData.blackwingTamerCodes)));
  pushBooleanGetter(L, "IsButterfly", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.butterflySetcodes, animeData.butterflyCodes) && !isAnimeArchetype(card, animeData.phantomButterflySetcodes, animeData.phantomButterflyCodes)));
  pushBooleanGetter(L, "IsC", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.cSetcodes, animeData.cCodes)));
  pushBooleanGetter(L, "IsCat", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.catSetcodes, animeData.catCodes)));
  pushBooleanGetter(L, "IsCelestial", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.celestialSetcodes, animeData.celestialCodes)));
  pushBooleanGetter(L, "IsCenozoic", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.cenozoicSetcodes, animeData.cenozoicCodes)));
  pushBooleanGetter(L, "IsCicada", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.cicadaSetcodes, animeData.cicadaCodes)));
  pushBooleanGetter(L, "IsClear", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.clearSetcodes, animeData.clearCodes)));
  pushBooleanGetter(L, "IsCN39UtopiaRay", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.cn39UtopiaRaySetcodes, animeData.cn39UtopiaRayCodes)));
  pushBooleanGetter(L, "IsComicsHero", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.comicsHeroSetcodes, animeData.comicsHeroCodes)));
  pushBooleanGetter(L, "IsCubicSeed", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.cubicSeedSetcodes, animeData.cubicSeedCodes)));
  pushBooleanGetter(L, "IsDarkness", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.darknessSetcodes, animeData.darknessCodes)));
  pushBooleanGetter(L, "IsDart", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.dartSetcodes, animeData.dartCodes)));
  pushBooleanGetter(L, "IsDice", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.diceSetcodes, animeData.diceCodes)));
  pushBooleanGetter(L, "IsDog", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.dogSetcodes, animeData.dogCodes)));
  pushBooleanGetter(L, "IsDoll", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.dollSetcodes, animeData.dollCodes)));
  pushBooleanGetter(L, "IsDruid", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.druidSetcodes, animeData.druidCodes)));
  pushBooleanGetter(L, "IsDyson", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.dysonSetcodes, animeData.dysonCodes)));
  pushBooleanGetter(L, "IsEarthboundServant", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.earthboundServantSetcodes, animeData.earthboundServantCodes)));
  pushBooleanGetter(L, "IsElf", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.elfSetcodes, animeData.elfCodes)));
  pushBooleanGetter(L, "IsEmissaryOfDarkness", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.emissaryOfDarknessSetcodes, animeData.emissaryOfDarknessCodes)));
  pushBooleanGetter(L, "IsFairy", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.fairySetcodes, animeData.fairyCodes)));
  pushBooleanGetter(L, "IsForest", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.forestSetcodes, animeData.forestCodes)));
  pushBooleanGetter(L, "IsFortressWhale", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.fortressWhaleSetcodes, animeData.fortressWhaleCodes)));
  pushBooleanGetter(L, "IsGaiatheDragonChampion", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.gaiaTheDragonChampionSetcodes, animeData.gaiaTheDragonChampionCodes)));
  pushBooleanGetter(L, "IsGemKnightLady", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.gemKnightLadySetcodes, animeData.gemKnightLadyCodes)));
  pushBooleanGetter(L, "IsGorgonic", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.gorgonicSetcodes, animeData.gorgonicCodes)));
  pushBooleanGetter(L, "IsGranel", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.granelSetcodes, animeData.granelCodes)));
  pushBooleanGetter(L, "IsRed", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.redSetcodes, animeData.redCodes)));
  pushBooleanGetter(L, "IsWhite", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.whiteSetcodes, animeData.whiteCodes)));
  pushBooleanGetter(L, "IsChampion", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.championSetcodes, animeData.championCodes)));
  pushBooleanGetter(L, "IsGoyo", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.goyoSetcodes, animeData.goyoCodes)));
  pushBooleanGetter(L, "IsHand", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.handSetcodes, animeData.handCodes)));
  pushBooleanGetter(L, "IsHarpieLadySisters", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.harpieLadySistersSetcodes, animeData.harpieLadySistersCodes)));
  pushBooleanGetter(L, "IsHelios", session, (card) => Boolean(card && isAnimeArchetype(card, [], animeData.heliosCodes)));
  pushBooleanGetter(L, "IsHell", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.hellSetcodes, animeData.hellCodes)));
  pushBooleanGetter(L, "IsHeraldic", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.heraldicSetcodes, animeData.heraldicCodes)));
  pushBooleanGetter(L, "IsHeavyIndustry", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.heavyIndustrySetcodes, animeData.heavyIndustryCodes)));
  pushBooleanGetter(L, "IsHunder", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.hunderSetcodes, animeData.hunderCodes)));
  pushBooleanGetter(L, "IsInsectQueen", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.insectQueenSetcodes, animeData.insectQueenCodes)));
  pushBooleanGetter(L, "IsInu", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.inuSetcodes, animeData.inuCodes)));
  pushBooleanGetter(L, "IsIvy", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.ivySetcodes, animeData.ivyCodes)));
  pushBooleanGetter(L, "IsJester", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.jesterSetcodes, animeData.jesterCodes)));
  pushBooleanGetter(L, "IsJutte", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.jutteSetcodes, animeData.jutteCodes)));
  pushBooleanGetter(L, "IsKangaroo", session, (card) => Boolean(card && isAnimeArchetype(card, [], animeData.kangarooCodes)));
  pushBooleanGetter(L, "IsKing", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.kingSetcodes, animeData.kingCodes) && !isAnimeArchetype(card, animeData.championSetcodes, animeData.championCodes)));
  pushBooleanGetter(L, "IsKnight", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.knightSetcodes, animeData.knightCodes)));
  pushBooleanGetter(L, "IsLamp", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.lampSetcodes, animeData.lampCodes)));
  pushBooleanGetter(L, "IsLandstar", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.landstarSetcodes, animeData.landstarCodes)));
  pushBooleanGetter(L, "IsMantis", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.mantisSetcodes, animeData.mantisCodes)));
  pushBooleanGetter(L, "IsMask", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.maskSetcodes, animeData.maskCodes)));
  pushBooleanGetter(L, "IsMelodiousSongtress", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.melodiousSongtressSetcodes, animeData.melodiousSongtressCodes)));
  pushBooleanGetter(L, "IsMesozoic", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.mesozoicSetcodes, animeData.mesozoicCodes)));
  pushBooleanGetter(L, "IsMonarch", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.monarchSetcodes, animeData.monarchCodes)));
  pushBooleanGetter(L, "IsMosquito", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.mosquitoSetcodes, animeData.mosquitoCodes)));
  pushBooleanGetter(L, "IsMotor", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.motorSetcodes, animeData.motorCodes)));
  pushBooleanGetter(L, "IsN39Utopia", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.n39UtopiaSetcodes, animeData.n39UtopiaCodes) && !isAnimeArchetype(card, animeData.cn39UtopiaRaySetcodes, animeData.cn39UtopiaRayCodes)));
  pushBooleanGetter(L, "IsNeko", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.nekoSetcodes, animeData.nekoCodes)));
  pushBooleanGetter(L, "IsPaleozoic", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.paleozoicSetcodes, animeData.paleozoicCodes)));
  pushBooleanGetter(L, "IsPapillon", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.papillonSetcodes, animeData.papillonCodes)));
  pushBooleanGetter(L, "IsParasite", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.parasiteSetcodes, animeData.parasiteCodes)));
  pushBooleanGetter(L, "IsPhantomButterfly", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.phantomButterflySetcodes, animeData.phantomButterflyCodes)));
  pushBooleanGetter(L, "IsPixie", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.pixieSetcodes, animeData.pixieCodes)));
  pushBooleanGetter(L, "IsPriestess", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.priestessSetcodes, animeData.priestessCodes)));
  pushBooleanGetter(L, "IsRaccoon", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.raccoonSetcodes, animeData.raccoonCodes)));
  pushBooleanGetter(L, "IsSeal", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.sealSetcodes, animeData.sealCodes)));
  pushBooleanGetter(L, "IsShaman", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.shamanSetcodes, animeData.shamanCodes)));
  pushBooleanGetter(L, "IsShark", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.sharkSetcodes, animeData.sharkCodes)));
  pushBooleanGetter(L, "IsShining", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.shiningSetcodes, animeData.shiningCodes)));
  pushBooleanGetter(L, "IsSkiel", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.skielSetcodes, animeData.skielCodes)));
  pushBooleanGetter(L, "IsSlime", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.slimeSetcodes, animeData.slimeCodes)));
  pushBooleanGetter(L, "IsSphere", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.sphereSetcodes, animeData.sphereCodes)));
  pushBooleanGetter(L, "IsStarship", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.starshipSetcodes, animeData.starshipCodes)));
  pushBooleanGetter(L, "IsStarvingVenemy", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.starvingVenemySetcodes, animeData.starvingVenemyCodes)));
  pushBooleanGetter(L, "IsStatue", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.statueSetcodes, animeData.statueCodes)));
  pushBooleanGetter(L, "IsStone", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.stoneSetcodes, animeData.stoneCodes)));
  pushBooleanGetter(L, "IsTachyon", session, (card) => Boolean(card && (isAnimeArchetype(card, animeData.tachyonSetcodes, animeData.tachyonCodes) || isAnimeArchetype(card, animeData.tachyonDragonSetcodes, animeData.tachyonDragonCodes))));
  pushBooleanGetter(L, "IsTachyonDragon", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.tachyonDragonSetcodes, animeData.tachyonDragonCodes)));
  pushBooleanGetter(L, "IsTheWingedDragonofRa", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.theWingedDragonOfRaSetcodes, animeData.theWingedDragonOfRaCodes)));
  pushBooleanGetter(L, "IsToy", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.toySetcodes, animeData.toyCodes)));
  pushBooleanGetter(L, "IsToyArcV", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.toyArcVSetcodes, [])));
  pushBooleanGetter(L, "IsV", session, (card) => Boolean(card && (isAnimeArchetype(card, animeData.vSetcodes, animeData.vCodes) || isAnimeArchetype(card, animeData.vZexalSetcodes, animeData.vZexalCodes))));
  pushBooleanGetter(L, "IsVirus", session, (card) => Boolean(card && isVirusCode(card.code)));
  pushBooleanGetter(L, "IsW", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.wSetcodes, animeData.wCodes)));
  pushBooleanGetter(L, "IsWisel", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.wiselSetcodes, animeData.wiselCodes)));
  pushBooleanGetter(L, "IsX", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.xSetcodes, animeData.xCodes)));
  pushBooleanGetter(L, "IsY", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.ySetcodes, animeData.yCodes)));
  pushBooleanGetter(L, "IsYomi", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.yomiSetcodes, animeData.yomiCodes)));
  pushBooleanGetter(L, "IsZ", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.zSetcodes, animeData.zCodes)));
  pushBooleanGetter(L, "IsEarth", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.earthSetcodes, animeData.earthCodes) && !isAnimeArchetype(card, animeData.hellSetcodes, animeData.hellCodes)));
  pushBooleanGetter(L, "IsSky", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.skySetcodes, animeData.skyCodes)));
  pushBooleanGetter(L, "Is_V_", session, (card) => Boolean(card && isAnimeArchetype(card, animeData.vZexalSetcodes, animeData.vZexalCodes)));
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

function isVirusCode(code: string): boolean {
  return (animeData.virusCodes as readonly string[]).includes(code);
}
