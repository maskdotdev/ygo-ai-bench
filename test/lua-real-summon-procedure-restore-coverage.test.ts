import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const SUMMON_PROCEDURE_FIXTURE_COUNT = 19;
const EVENT_RICH_SUMMON_PROCEDURE_FIXTURE_COUNT = 17;
const summonProcedureKindCounts = {
  broadTypedProcedure: 1,
  deckTwoMaterialShufflePierceProcedure: 2,
  graveBanishCostStatProcedure: 1,
  handOwnFaceupAttributeOpenZoneProcedure: 2,
  handAttributeBanishCostSearchProcedure: 1,
  handReleaseEquipTurnCounterProcedure: 1,
  handBothFieldsGimmickOnlyProcedure: 1,
  handOwnEmptyOpponentMonsterProcedure: 1,
  handOpponentCountProcedure: 1,
  handOwnFaceupLevelOrLinkOpenZoneProcedure: 3,
  handOwnFaceupSetcodeOpenZoneProcedure: 1,
  handOpponentBackrowCountProcedure: 1,
  handOpponentSpellTrapOrMstProcedure: 1,
  handSendCostProcedure: 1,
  noTributeOpponentMonsterCountProcedure: 1,
} satisfies Record<SummonProcedureKind, number>;
const summonProcedureSemanticVariantCounts = {
  broadTypedExtraDeckSpiritGeminiProcedures: 1,
  caligoClawCrowDarkMonsterOpenZoneProcedure: 1,
  gokaFireMonsterOpenZoneProcedureDestroyReleaseStat: 1,
  blackwingGaleSetcodeOpenZoneProcedureFinalStat: 1,
  collapserpentLightBanishCostSearchProcedure: 1,
  familiarPossessedDharcDeckTwoMaterialShufflePierceSearchProcedure: 1,
  familiarPossessedDeckTwoMaterialShufflePierceProcedure: 1,
  gigaraysGandoraTwoMonsterSendCostProcedure: 1,
  greatMothCocoonEquipTurnCounterReleaseProcedure: 1,
  magnetDollBothFieldsGimmickOnlyHandProcedure: 1,
  earthArmorNinjaOwnEmptyOpponentMonsterProcedure: 1,
  megarockDragonGraveBanishStatProcedure: 1,
  escherOpponentBackrowCountProcedure: 1,
  pankratopsOpponentControlsMoreHandProcedure: 1,
  radiantTyphoonOpponentSpellTrapOrMstProcedureSearch: 1,
  sprightBlueLevelOrRankOpenZoneProcedureSearch: 1,
  sprightPixiesLevelOrRankOpenZoneProcedurePrecalcStat: 1,
  sprightRedLevelOrLinkOpenZoneProcedure: 1,
  powerInvaderOpponentTwoMonsterNormalSummonProcedure: 1,
} satisfies Record<SummonProcedureSemanticVariant, number>;

type SummonProcedureKind =
  | "broadTypedProcedure"
  | "deckTwoMaterialShufflePierceProcedure"
  | "graveBanishCostStatProcedure"
  | "handAttributeBanishCostSearchProcedure"
  | "handOwnFaceupAttributeOpenZoneProcedure"
  | "handOwnFaceupSetcodeOpenZoneProcedure"
  | "handReleaseEquipTurnCounterProcedure"
  | "handBothFieldsGimmickOnlyProcedure"
  | "handOwnEmptyOpponentMonsterProcedure"
  | "handOpponentCountProcedure"
  | "handOwnFaceupLevelOrLinkOpenZoneProcedure"
  | "handOpponentBackrowCountProcedure"
  | "handOpponentSpellTrapOrMstProcedure"
  | "handSendCostProcedure"
  | "noTributeOpponentMonsterCountProcedure";
type SummonProcedureSemanticVariant =
  | "broadTypedExtraDeckSpiritGeminiProcedures"
  | "blackwingGaleSetcodeOpenZoneProcedureFinalStat"
  | "caligoClawCrowDarkMonsterOpenZoneProcedure"
  | "gokaFireMonsterOpenZoneProcedureDestroyReleaseStat"
  | "collapserpentLightBanishCostSearchProcedure"
  | "familiarPossessedDharcDeckTwoMaterialShufflePierceSearchProcedure"
  | "familiarPossessedDeckTwoMaterialShufflePierceProcedure"
  | "gigaraysGandoraTwoMonsterSendCostProcedure"
  | "greatMothCocoonEquipTurnCounterReleaseProcedure"
  | "magnetDollBothFieldsGimmickOnlyHandProcedure"
  | "earthArmorNinjaOwnEmptyOpponentMonsterProcedure"
  | "megarockDragonGraveBanishStatProcedure"
  | "escherOpponentBackrowCountProcedure"
  | "pankratopsOpponentControlsMoreHandProcedure"
  | "radiantTyphoonOpponentSpellTrapOrMstProcedureSearch"
  | "sprightBlueLevelOrRankOpenZoneProcedureSearch"
  | "sprightPixiesLevelOrRankOpenZoneProcedurePrecalcStat"
  | "sprightRedLevelOrLinkOpenZoneProcedure"
  | "powerInvaderOpponentTwoMonsterNormalSummonProcedure";

const summonProcedureFixtures = [
  {
    file: "test/lua-real-script-summon-procedure.test.ts",
    kind: "broadTypedProcedure",
    required: [
      'action.type === "specialSummonProcedure"',
      'action.type === "xyzSummon"',
      'action.type === "linkSummon"',
      'action.type === "synchroSummon"',
      'summonType: "xyz"',
      'summonType: "link"',
      'summonType: "synchro"',
      "Spirit procedure End Phase return",
      "real cannot-be-Special-Summoned conditions for Spirit monsters",
      "real Gemini second Normal Summon triggers",
      "triggerRestored.missingRegistryKeys).toEqual([])",
      "triggerRestored.missingChainLimitRegistryKeys).toEqual([])",
    ],
  },
  {
    file: "test/lua-real-script-pankratops-special-summon-procedure.test.ts",
    kind: "handOpponentCountProcedure",
    required: [
      "opponent-controls-more-monsters hand Special Summon procedure",
      'action.type === "specialSummonProcedure"',
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))",
      "applyRestoredActionAndAssert(restored, procedure!)",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-gimmick-puppet-magnet-doll-special-summon-procedure.test.ts",
    kind: "handBothFieldsGimmickOnlyProcedure",
    required: [
      "both-fields Gimmick Puppet-only hand Special Summon procedure",
      'fieldCase: "noOpponentMonster"',
      'fieldCase: "ownNonPuppet"',
      'fieldCase: "ownFaceDownPuppet"',
      'action.type === "specialSummonProcedure"',
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))",
      "applyRestoredActionAndAssert(restored, procedure!)",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-earth-armor-ninja-empty-field-procedure.test.ts",
    kind: "handOwnEmptyOpponentMonsterProcedure",
    required: [
      "own MZONE is empty and opponent controls a monster",
      'fieldCase: "noOpponentMonster"',
      'fieldCase: "ownMonsterPresent"',
      'action.type === "specialSummonProcedure"',
      "Duel.GetFieldGroupCount(c:GetControler(),LOCATION_MZONE,0,nil)==0",
      "Duel.GetFieldGroupCount(c:GetControler(),0,LOCATION_MZONE,nil)>0",
      "Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0",
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))",
      "applyRestoredActionAndAssert(restored, procedure!)",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-collapserpent-special-summon-procedure-search.test.ts",
    kind: "handAttributeBanishCostSearchProcedure",
    required: [
      "LIGHT banish-cost hand Special Summon procedure and on-field to-Graveyard Wyverburster search",
      'const collapserpentCode = "61901281"',
      'caseKind: "blocked"',
      'caseKind: "valid"',
      'action.type === "specialSummonProcedure"',
      "return c:IsAttribute(ATTRIBUTE_LIGHT) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)",
      "aux.SelectUnselectGroup(rg,e,tp,1,1,nil,1,tp,HINTMSG_REMOVE,nil,nil,true)",
      "Duel.Remove(g,POS_FACEUP,REASON_COST)",
      "return e:GetHandler():IsPreviousLocation(LOCATION_ONFIELD)",
      "return c:IsCode(99234526) and c:IsAbleToHand()",
      "expectRestoredLegalActions(restoredProcedure, 0)",
      "applyRestoredActionAndAssert(restoredProcedure, procedure!)",
      'eventName: "banished"',
      'eventName: "specialSummoned"',
      'eventName: "sentToHandConfirmed"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-caligo-claw-crow-special-summon-procedure.test.ts",
    kind: "handOwnFaceupAttributeOpenZoneProcedure",
    required: [
      "face-up DARK monster and open MZONE hand Special Summon procedure",
      'const caligoCode = "67692580"',
      'fieldCase: "wrongAttribute"',
      'fieldCase: "faceDownDark"',
      'fieldCase: "fullMonsterZone"',
      'action.type === "specialSummonProcedure"',
      "Duel.GetLocationCount(tp,LOCATION_MZONE)>0",
      "Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,1,nil)",
      "return c:IsFaceup() and c:IsAttribute(ATTRIBUTE_DARK)",
      "expectRestoredActionSurfaces(restored, 0)",
      "applyLuaRestoreResponse(restored, procedure as DuelAction)",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-goka-procedure-destroy-release-stat.test.ts",
    kind: "handOwnFaceupAttributeOpenZoneProcedure",
    required: [
      "restores FIRE-gated inherent Special Summon, mandatory destroy trigger, and release-cost ATK gain",
      'action.type === "specialSummonProcedure"',
      "Duel.GetLocationCount(tp,LOCATION_MZONE)>0",
      "Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsAttribute,ATTRIBUTE_FIRE),tp,LOCATION_MZONE,0,1,nil)",
      "e2:SetCondition(function(e) return e:GetHandler():IsSummonType(SUMMON_TYPE_SPECIAL+1) end)",
      "expectRestoredLegalActions(restoredProcedure, 0)",
      "applyRestoredActionAndAssert(restoredProcedure, procedure!)",
      "summonTypeCode: 0x40000001",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-blackwing-gale-procedure-final-stat.test.ts",
    kind: "handOwnFaceupSetcodeOpenZoneProcedure",
    required: [
      "same-set hand Special Summon procedure and target final ATK/DEF halving",
      'const galeCode = "2009101"',
      'fieldCase: "noSetAlly"',
      'fieldCase: "faceDownAlly"',
      'action.type === "specialSummonProcedure"',
      "Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0",
      "Duel.IsExistingMatchingCard(s.filter,c:GetControler(),LOCATION_MZONE,0,1,nil)",
      "return c:IsFaceup() and c:IsSetCard(SET_BLACKWING) and c:GetCode()~=id",
      "expectRestoredLegalActions(restoredProcedure, 0)",
      "applyRestoredActionAndAssert(restoredProcedure, procedure!)",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-escher-opponent-backrow-special-summon-procedure.test.ts",
    kind: "handOpponentBackrowCountProcedure",
    required: [
      "opponent backrow Special Summon procedure",
      'const escherCode = "24326617"',
      'action.type === "specialSummonProcedure"',
      "Duel.IsExistingMatchingCard(s.filter,tp,0,LOCATION_SZONE,2,nil)",
      "expect(getDuelLegalActions(session, 0).some((action) => action.type === \"specialSummonProcedure\" && action.uid === escher!.uid)).toBe(false)",
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-spright-red-release-link2-negate.test.ts",
    kind: "handOwnFaceupLevelOrLinkOpenZoneProcedure",
    required: [
      "hand summon procedure, Link-2 release cost",
      'action.type === "specialSummonProcedure"',
      "Duel.GetLocationCount(tp,LOCATION_MZONE)>0",
      "return c:IsFaceup() and (c:IsLevel(2) or c:IsLink(2))",
      "expectRestoredLegalActions(restoredSummonWindow, 1)",
      "applyLuaRestoreResponse(restored, response)",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-great-moth-release-equip-special-summon-procedure.test.ts",
    kind: "handReleaseEquipTurnCounterProcedure",
    required: [
      "Cocoon of Evolution release gated by an equipped Petit Moth turn counter",
      'const greatMothCode = "14141448"',
      'const petitMothCode = "40240595"',
      'const cocoonCode = "58192742"',
      "c:GetTurnCounter()>=4",
      "c:GetEquipGroup():IsExists(s.eqfilter,1,nil)",
      "Duel.CheckReleaseGroup(c:GetControler(),s.rfilter,1,false,1,true,c,c:GetControler(),nil,false,nil)",
      "Duel.SelectReleaseGroup(tp,s.rfilter,1,1,false,true,true,c,nil,nil,false,nil)",
      "Duel.Release(g,REASON_COST)",
      "expectRestoredActionSurfaces(restored, 0)",
      "applyLuaRestoreResponse(restored, procedure as DuelAction)",
      'eventName: "released"',
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-familiar-possessed-dharc-special-summon-procedure-search.test.ts",
    kind: "deckTwoMaterialShufflePierceProcedure",
    required: [
      "Deck summon procedure materials, pierce grant, and summon-success LIGHT Spellcaster search",
      'const dharcCode = "21390858"',
      'action.type === "specialSummonProcedure"',
      "aux.SelectUnselectGroup(g1,e,tp,2,2,s.rescon,1,tp,HINTMSG_TOGRAVE)",
      "Duel.SendtoGrave(g,REASON_COST)",
      "Duel.ShuffleDeck(tp)",
      "getLuaRestoreLegalActions(restoredProcedure, 0)).toEqual(getLegalActions(restoredProcedure.session, 0))",
      "applyRestoredActionAndAssert(restoredProcedure, procedure!)",
      'eventName: "sentToGraveyard"',
      'eventName: "specialSummoned"',
      'eventName: "sentToHandConfirmed"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
      "effect.code === 203",
    ],
  },
  {
    file: "test/lua-real-script-familiar-possessed-hiita-deck-special-summon-procedure.test.ts",
    kind: "deckTwoMaterialShufflePierceProcedure",
    required: [
      "Deck summon procedure material selection, cost send, deck shuffle, and piercing grant",
      'const hiitaCode = "4376658"',
      'action.type === "specialSummonProcedure"',
      "aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,0)",
      "Duel.SendtoGrave(g,REASON_COST)",
      "Duel.ShuffleDeck(tp)",
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))",
      "applyRestoredActionAndAssert(restored, procedure!)",
      'eventName: "sentToGraveyard"',
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
      "effect.code === 203",
    ],
  },
  {
    file: "test/lua-real-script-gigarays-gandora-special-summon-procedure.test.ts",
    kind: "handSendCostProcedure",
    required: [
      "two-monster send-to-Graveyard hand Special Summon procedure cost",
      'action.type === "specialSummonProcedure"',
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))",
      "applyRestoredActionAndAssert(restored, procedure!)",
      'eventName: "sentToGraveyard"',
      "eventReason: duelReason.cost",
    ],
  },
  {
    file: "test/lua-real-script-radiant-typhoon-eldam-special-summon-procedure-search.test.ts",
    kind: "handOpponentSpellTrapOrMstProcedure",
    required: [
      "opponent-field/MST-gated hand Special Summon procedure and summon-success Deck search",
      'const eldamCode = "54143349"',
      'caseKind: "blocked"',
      'caseKind: "openNoOpponentSpell"',
      'caseKind: "openWithMst"',
      'action.type === "specialSummonProcedure"',
      "Duel.IsExistingMatchingCard(Card.IsCode,tp,LOCATION_GRAVE,0,1,nil,CARD_MYSTICAL_SPACE_TYPHOON)",
      "not Duel.IsExistingMatchingCard(Card.IsSpellTrap,tp,0,LOCATION_ONFIELD,1,nil)",
      "return ((c:IsSetCard(SET_RADIANT_TYPHOON) and c:IsMonster()) or c:IsCode(CARD_MYSTICAL_SPACE_TYPHOON)) and c:IsAbleToHand() and not c:IsCode(id)",
      "expectRestoredLegalActions(restoredProcedure, 0)",
      "applyRestoredActionAndAssert(restoredProcedure, procedure!)",
      'eventName: "specialSummoned"',
      'eventName: "sentToHandConfirmed"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-spright-blue-special-summon-procedure-search.test.ts",
    kind: "handOwnFaceupLevelOrLinkOpenZoneProcedure",
    required: [
      "Level/Rank 2 hand Special Summon procedure, oath count, and delayed Deck search",
      'const sprightBlueCode = "76145933"',
      "e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)",
      "return c:IsFaceup() and (c:IsLevel(2) or c:IsRank(2))",
      "withEnabler: false",
      "withEnabler: true",
      'action.type === "specialSummonProcedure"',
      "getLuaRestoreLegalActions(restoredChain, 0).some((action) => action.type === \"specialSummonProcedure\" && action.uid === secondBlue.uid)).toBe(false)",
      'eventName: "specialSummoned"',
      'eventName: "sentToHandConfirmed"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-spright-pixies-procedure-precalc-stat.test.ts",
    kind: "handOwnFaceupLevelOrLinkOpenZoneProcedure",
    required: [
      "oath hand procedure and pre-damage SelfToGrave GetBattleMonster stat boost",
      'const pixiesCode = "49928686"',
      'action.type === "specialSummonProcedure"',
      "Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(s.spconfilter,tp,LOCATION_MZONE,0,1,nil)",
      "e2:SetCost(Cost.SelfToGrave)",
      "local a,d=Duel.GetBattleMonster(tp)",
      "expectRestoredLegalActions(restoredProcedure, 0)",
      "applyRestoredActionAndAssert(restoredProcedure, procedure!)",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-megarock-dragon-special-summon-procedure.test.ts",
    kind: "graveBanishCostStatProcedure",
    required: [
      "Rock graveyard banish-cost procedure and selected-count base stats",
      'action.type === "specialSummonProcedure"',
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))",
      "applyRestoredActionAndAssert(restored, procedure!)",
      'location: "banished"',
      "previousLocation: \"graveyard\"",
      "currentAttack(restoredMegarock, restored.session.state)).toBe(700)",
    ],
  },
  {
    file: "test/lua-real-script-power-invader-opponent-count-summon-procedure.test.ts",
    kind: "noTributeOpponentMonsterCountProcedure",
    required: [
      "no-tribute Normal Summon procedure gated by two opponent monsters",
      'const powerInvaderCode = "18842395"',
      'action.type === "tributeSummon"',
      "Duel.GetFieldGroupCount(c:GetControler(),0,LOCATION_MZONE)>=2",
      "condition:normal-summon-proc-opponent-mzone-count-at-least:2:source-level-above:4",
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActionGroups(blocked, 0)).toEqual(getGroupedDuelLegalActions(blocked.session, 0))",
      'eventName: "normalSummoned"',
      "eventReason: duelReason.summon",
    ],
  },
] satisfies Array<{
  file: string;
  kind: SummonProcedureKind;
  required: string[];
}>;

describe("Lua real summon procedure restore coverage", () => {
  it("requires the broad summon procedure fixture to assert clean restore and restored legal actions", () => {
    expect(summonProcedureFixtures).toHaveLength(SUMMON_PROCEDURE_FIXTURE_COUNT);

    for (const { file, required } of summonProcedureFixtures) {
      const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));

      expect(text.includes("restoreDuelWithLuaScripts")).toBe(true);
      expect(text.includes("restoreComplete")).toBe(true);
      expect(text.includes('incompleteReasons.join("; ")')).toBe(true);
      expect(text.includes("missingRegistryKeys).toEqual([])")).toBe(true);
      expect(text.includes("missingChainLimitRegistryKeys).toEqual([])")).toBe(true);
      for (const snippet of required) {
        expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
      }
    }
  });

  it("keeps summon procedure fixture kinds explicit", () => {
    expect(countSummonProcedureKinds(summonProcedureFixtures)).toEqual(summonProcedureKindCounts);
  });

  it("keeps named summon procedure semantic variants explicit", () => {
    expect(countSummonProcedureSemanticVariants(summonProcedureSemanticVariants())).toEqual(
      summonProcedureSemanticVariantCounts,
    );

    const weak = summonProcedureSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("requires focused summon procedure fixtures to pin event identity after restore", () => {
    const fixtures = eventRichSummonProcedureFixtures();
    expect(fixtures).toHaveLength(EVENT_RICH_SUMMON_PROCEDURE_FIXTURE_COUNT);

    const weak = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function countSummonProcedureKinds(
  fixtures: Array<{ kind: SummonProcedureKind }>,
): Record<SummonProcedureKind, number> {
  return fixtures.reduce<Record<SummonProcedureKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      broadTypedProcedure: 0,
      graveBanishCostStatProcedure: 0,
      deckTwoMaterialShufflePierceProcedure: 0,
      handAttributeBanishCostSearchProcedure: 0,
      handOwnFaceupAttributeOpenZoneProcedure: 0,
      handOwnFaceupSetcodeOpenZoneProcedure: 0,
      handOwnFaceupLevelOrLinkOpenZoneProcedure: 0,
      handOpponentBackrowCountProcedure: 0,
      handOpponentSpellTrapOrMstProcedure: 0,
      handReleaseEquipTurnCounterProcedure: 0,
      handBothFieldsGimmickOnlyProcedure: 0,
      handOwnEmptyOpponentMonsterProcedure: 0,
      handOpponentCountProcedure: 0,
      handSendCostProcedure: 0,
      noTributeOpponentMonsterCountProcedure: 0,
    },
  );
}

function summonProcedureSemanticVariants(): Array<{
  file: string;
  kind: SummonProcedureSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-summon-procedure.test.ts",
      kind: "broadTypedExtraDeckSpiritGeminiProcedures",
      required: [
        'const diabellstarCode = "72270339"',
        "restores official Xyz.AddProcedure material counts for real extra deck summons",
        "restores official Synchro.AddProcedure tuner and non-tuner count ranges for real extra deck summons",
        "restores Spirit procedure End Phase return after a real Normal Summon",
      ],
    },
    {
      file: "test/lua-real-script-caligo-claw-crow-special-summon-procedure.test.ts",
      kind: "caligoClawCrowDarkMonsterOpenZoneProcedure",
      required: [
        'const caligoCode = "67692580"',
        "restores its face-up DARK monster and open MZONE hand Special Summon procedure",
        'fieldCase: "wrongAttribute"',
        'fieldCase: "faceDownDark"',
        'fieldCase: "fullMonsterZone"',
        "Duel.GetLocationCount(tp,LOCATION_MZONE)>0",
      ],
    },
    {
      file: "test/lua-real-script-blackwing-gale-procedure-final-stat.test.ts",
      kind: "blackwingGaleSetcodeOpenZoneProcedureFinalStat",
      required: [
        'const galeCode = "2009101"',
        "restores same-set hand Special Summon procedure and target final ATK/DEF halving",
        'fieldCase: "noSetAlly"',
        'fieldCase: "faceDownAlly"',
        "return c:IsFaceup() and c:IsSetCard(SET_BLACKWING) and c:GetCode()~=id",
        'eventName: "specialSummoned"',
        "currentAttack(opponent, restoredIgnition.session.state)).toBe(1300)",
      ],
    },
    {
      file: "test/lua-real-script-collapserpent-special-summon-procedure-search.test.ts",
      kind: "collapserpentLightBanishCostSearchProcedure",
      required: [
        'const collapserpentCode = "61901281"',
        "restores its LIGHT banish-cost hand Special Summon procedure and on-field to-Graveyard Wyverburster search",
        'caseKind: "blocked"',
        'caseKind: "valid"',
        'eventName: "banished"',
        'eventName: "specialSummoned"',
        'eventName: "sentToHandConfirmed"',
      ],
    },
    {
      file: "test/lua-real-script-familiar-possessed-dharc-special-summon-procedure-search.test.ts",
      kind: "familiarPossessedDharcDeckTwoMaterialShufflePierceSearchProcedure",
      required: [
        'const dharcCode = "21390858"',
        "restores its Deck summon procedure materials, pierce grant, and summon-success LIGHT Spellcaster search",
        "aux.SelectUnselectGroup(g1,e,tp,2,2,s.rescon,1,tp,HINTMSG_TOGRAVE)",
        "Duel.ShuffleDeck(tp)",
        'eventName: "sentToHandConfirmed"',
        "effect.code === 203",
      ],
    },
    {
      file: "test/lua-real-script-familiar-possessed-hiita-deck-special-summon-procedure.test.ts",
      kind: "familiarPossessedDeckTwoMaterialShufflePierceProcedure",
      required: [
        'const hiitaCode = "4376658"',
        "restores its Deck summon procedure material selection, cost send, deck shuffle, and piercing grant",
        "aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,0)",
        "Duel.ShuffleDeck(tp)",
        "effect.code === 203",
      ],
    },
    {
      file: "test/lua-real-script-gigarays-gandora-special-summon-procedure.test.ts",
      kind: "gigaraysGandoraTwoMonsterSendCostProcedure",
      required: [
        'const gandoraCode = "58330108"',
        "restores its two-monster send-to-Graveyard hand Special Summon procedure cost",
        'eventName: "sentToGraveyard"',
      ],
    },
    {
      file: "test/lua-real-script-great-moth-release-equip-special-summon-procedure.test.ts",
      kind: "greatMothCocoonEquipTurnCounterReleaseProcedure",
      required: [
        'const greatMothCode = "14141448"',
        "Cocoon of Evolution release gated by an equipped Petit Moth turn counter",
        "c:GetTurnCounter()>=4",
        "c:GetEquipGroup():IsExists(s.eqfilter,1,nil)",
        'eventName: "released"',
      ],
    },
    {
      file: "test/lua-real-script-goka-procedure-destroy-release-stat.test.ts",
      kind: "gokaFireMonsterOpenZoneProcedureDestroyReleaseStat",
      required: [
        'const gokaCode = "23116808"',
        "restores FIRE-gated inherent Special Summon, mandatory destroy trigger, and release-cost ATK gain",
        "Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsAttribute,ATTRIBUTE_FIRE),tp,LOCATION_MZONE,0,1,nil)",
        "e2:SetCondition(function(e) return e:GetHandler():IsSummonType(SUMMON_TYPE_SPECIAL+1) end)",
        "Duel.CheckReleaseGroupCost(tp,Card.IsAttribute,1,false,nil,c,ATTRIBUTE_FIRE)",
        'eventName: "specialSummoned"',
        'eventName: "destroyed"',
        'eventName: "released"',
      ],
    },
    {
      file: "test/lua-real-script-gimmick-puppet-magnet-doll-special-summon-procedure.test.ts",
      kind: "magnetDollBothFieldsGimmickOnlyHandProcedure",
      required: [
        'const magnetDollCode = "39806198"',
        "both-fields Gimmick Puppet-only hand Special Summon procedure",
        'fieldCase: "ownNonPuppet"',
        'fieldCase: "ownFaceDownPuppet"',
      ],
    },
    {
      file: "test/lua-real-script-earth-armor-ninja-empty-field-procedure.test.ts",
      kind: "earthArmorNinjaOwnEmptyOpponentMonsterProcedure",
      required: [
        'const earthArmorCode = "22812068"',
        "restores its hand procedure only when own MZONE is empty and opponent controls a monster",
        'fieldCase: "noOpponentMonster"',
        'fieldCase: "ownMonsterPresent"',
        "Duel.GetFieldGroupCount(c:GetControler(),LOCATION_MZONE,0,nil)==0",
        'eventName: "specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-megarock-dragon-special-summon-procedure.test.ts",
      kind: "megarockDragonGraveBanishStatProcedure",
      required: [
        'const megarockCode = "71544954"',
        "restores its Rock graveyard banish-cost procedure and selected-count base stats",
        "currentAttack(restoredMegarock, restored.session.state)).toBe(700)",
      ],
    },
    {
      file: "test/lua-real-script-pankratops-special-summon-procedure.test.ts",
      kind: "pankratopsOpponentControlsMoreHandProcedure",
      required: [
        'const pankratopsCode = "82385847"',
        "restores its opponent-controls-more-monsters hand Special Summon procedure",
        'eventName: "specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-escher-opponent-backrow-special-summon-procedure.test.ts",
      kind: "escherOpponentBackrowCountProcedure",
      required: [
        'const escherCode = "24326617"',
        "restores its hand procedure gated by two opponent Spell/Trap cards",
        "Duel.IsExistingMatchingCard(s.filter,tp,0,LOCATION_SZONE,2,nil)",
        'eventName: "specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-power-invader-opponent-count-summon-procedure.test.ts",
      kind: "powerInvaderOpponentTwoMonsterNormalSummonProcedure",
      required: [
        'const powerInvaderCode = "18842395"',
        "restores its no-tribute Normal Summon procedure gated by two opponent monsters",
        "Duel.GetFieldGroupCount(c:GetControler(),0,LOCATION_MZONE)>=2",
        "condition:normal-summon-proc-opponent-mzone-count-at-least:2:source-level-above:4",
        'eventName: "normalSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-radiant-typhoon-eldam-special-summon-procedure-search.test.ts",
      kind: "radiantTyphoonOpponentSpellTrapOrMstProcedureSearch",
      required: [
        'const eldamCode = "54143349"',
        "restores its opponent-field/MST-gated hand Special Summon procedure and summon-success Deck search",
        'caseKind: "blocked"',
        'caseKind: "openNoOpponentSpell"',
        'caseKind: "openWithMst"',
        'eventName: "specialSummoned"',
        'eventName: "sentToHandConfirmed"',
      ],
    },
    {
      file: "test/lua-real-script-spright-blue-special-summon-procedure-search.test.ts",
      kind: "sprightBlueLevelOrRankOpenZoneProcedureSearch",
      required: [
        'const sprightBlueCode = "76145933"',
        "restores its Level/Rank 2 hand Special Summon procedure, oath count, and delayed Deck search",
        "e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)",
        "return c:IsFaceup() and (c:IsLevel(2) or c:IsRank(2))",
        'eventName: "specialSummoned"',
        'eventName: "sentToHandConfirmed"',
      ],
    },
    {
      file: "test/lua-real-script-spright-pixies-procedure-precalc-stat.test.ts",
      kind: "sprightPixiesLevelOrRankOpenZoneProcedurePrecalcStat",
      required: [
        'const pixiesCode = "49928686"',
        "restores oath hand procedure and pre-damage SelfToGrave GetBattleMonster stat boost",
        "Duel.GetLocationCount(tp,LOCATION_MZONE)>0 and Duel.IsExistingMatchingCard(s.spconfilter,tp,LOCATION_MZONE,0,1,nil)",
        "e2:SetCost(Cost.SelfToGrave)",
        "local a,d=Duel.GetBattleMonster(tp)",
        "battleDamage[1]).toBe(1000)",
      ],
    },
    {
      file: "test/lua-real-script-spright-red-release-link2-negate.test.ts",
      kind: "sprightRedLevelOrLinkOpenZoneProcedure",
      required: [
        'const sprightRedCode = "75922381"',
        "restores its hand summon procedure, Link-2 release cost, yes/no destroy prompt, negation, and suppressed monster operation",
        "Duel.GetLocationCount(tp,LOCATION_MZONE)>0",
        "return c:IsFaceup() and (c:IsLevel(2) or c:IsLink(2))",
        'action.type === "specialSummonProcedure"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonProcedureSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function eventRichSummonProcedureFixtures(): Array<{
  file: string;
  kind: SummonProcedureKind;
  required: string[];
}> {
  return summonProcedureFixtures
    .filter(({ kind }) => kind !== "broadTypedProcedure" && kind !== "noTributeOpponentMonsterCountProcedure")
    .map(({ file, kind }) => ({
      file,
      kind,
      required: [
        "eventCode: 1102",
        "eventCardUid:",
        "eventReason: duelReason.summon | duelReason.specialSummon",
        ...(kind === "handSendCostProcedure"
          ? [
              'eventName: "sentToGraveyard"',
              "eventCode: 1014",
              "eventReasonCardUid: gandora!.uid",
              "eventReasonEffectId: 2",
              "eventUids: [fieldCost!.uid, handCost!.uid]",
            ]
          : []),
        ...(kind === "deckTwoMaterialShufflePierceProcedure"
          ? [
              'eventName: "sentToGraveyard"',
              "eventCode: 1014",
              "eventReasonCardUid: hiita!.uid",
              "eventReasonEffectId: 1",
              "eventUids: [charmer!.uid, fireMaterial!.uid]",
            ]
          : []),
        ...(kind === "graveBanishCostStatProcedure"
          ? [
              'eventName: "banished"',
              "eventCode: 1011",
              "eventReasonCardUid: megarock!.uid",
              "eventReasonEffectId: 3",
            ]
          : []),
        ...(kind === "handReleaseEquipTurnCounterProcedure"
          ? [
              'eventName: "released"',
              "eventCode: 1017",
              "eventReasonCardUid: greatMoth!.uid",
              "eventReasonEffectId: 2",
              "previousEquippedToUid: cocoon!.uid",
            ]
          : []),
      ],
    }));
}

function countSummonProcedureSemanticVariants(
  fixtures: Array<{ kind: SummonProcedureSemanticVariant }>,
): Record<SummonProcedureSemanticVariant, number> {
  return fixtures.reduce<Record<SummonProcedureSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      broadTypedExtraDeckSpiritGeminiProcedures: 0,
      blackwingGaleSetcodeOpenZoneProcedureFinalStat: 0,
      caligoClawCrowDarkMonsterOpenZoneProcedure: 0,
      gokaFireMonsterOpenZoneProcedureDestroyReleaseStat: 0,
      collapserpentLightBanishCostSearchProcedure: 0,
      familiarPossessedDharcDeckTwoMaterialShufflePierceSearchProcedure: 0,
      familiarPossessedDeckTwoMaterialShufflePierceProcedure: 0,
      gigaraysGandoraTwoMonsterSendCostProcedure: 0,
      greatMothCocoonEquipTurnCounterReleaseProcedure: 0,
      magnetDollBothFieldsGimmickOnlyHandProcedure: 0,
      earthArmorNinjaOwnEmptyOpponentMonsterProcedure: 0,
      megarockDragonGraveBanishStatProcedure: 0,
      escherOpponentBackrowCountProcedure: 0,
      pankratopsOpponentControlsMoreHandProcedure: 0,
      radiantTyphoonOpponentSpellTrapOrMstProcedureSearch: 0,
      sprightBlueLevelOrRankOpenZoneProcedureSearch: 0,
      sprightPixiesLevelOrRankOpenZoneProcedurePrecalcStat: 0,
      sprightRedLevelOrLinkOpenZoneProcedure: 0,
      powerInvaderOpponentTwoMonsterNormalSummonProcedure: 0,
    },
  );
}
