import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const summonTriggerOperationFixtureCount = 28;
const summonTriggerOperationKindCounts = {
  specialSummonDeckCostLabelDamage: 1,
  specialSummonDamageStatExtraSummon: 1,
  summonDraw: 1,
  summonMassDestroy: 1,
  summonSearch: 8,
  summonSearchDiscard: 1,
  summonSearchSelfSummon: 1,
  summonSelfDestroy: 1,
  summonSetFlipToHand: 1,
  summonSuccessDeckSpecialSummon: 1,
  summonSuccessFieldHandSelfSummon: 2,
  summonSuccessHandSpecialSummon: 1,
  summonToGraveGraveyardRevive: 1,
  summonStepReviveDisable: 1,
  summonToGraveDeckSummon: 1,
  summonToDeck: 1,
  summonTargetDestroy: 1,
  summonTargetLevelUpdate: 1,
  summonToHandBounce: 2,
} satisfies Record<SummonTriggerOperationKind, number>;
const summonTriggerOperationSemanticVariantCounts = {
  aratamaSpiritSearchOnSummon: 1,
  ashokaPillarSearchPositionDamage: 1,
  blackwingNothungSummonDamageStatExtraSummon: 1,
  backupIgnisterSearchDiscardOnSummon: 1,
  crashbugZSummonSuccessDeckSpecialSummon: 1,
  craneCraneStepReviveDisableOnSummon: 1,
  cyberDinosaurOpponentHandSummon: 1,
  darkDustSpiritMassDestroyOnSummon: 1,
  driangleDeckDiscardLabelDamage: 1,
  flameArmorNinjaSummonLevelUpdate: 1,
  floowandereezeRobinaSearchNormalSummon: 1,
  gemArmadilloNormalSummonSearch: 1,
  gemKnightObsidianHandToGraveyardRevive: 1,
  gishkiNataliaGraveToDeckTopOnSummon: 1,
  gorgonicGargoyleRockSummon: 1,
  golemSentryTurnSetFlipReturn: 1,
  hanShiKyudoColumnReturnOnSummon: 1,
  ichikiSayoriHimeEffectSummonSearch: 1,
  izanamiDiscardGraveSpiritReturnOnSummon: 1,
  moonlitPapillonToGraveDeckSummon: 1,
  nuviaSummonSelfDestroyFieldCountStat: 1,
  rGenexMagmaLevelSetSearch: 1,
  rGenexOverseerClonedSummonHandSpecialSummon: 1,
  senjuClonedSummonRitualMonsterSearch: 1,
  shinobaronessShadePeacockSearchSelfSummon: 1,
  shinobirdCraneDrawOnSpiritSummon: 1,
  yakshaBackrowReturnOnSummon: 1,
  swarmScarabsFlipSummonTargetDestroy: 1,
} satisfies Record<SummonTriggerOperationSemanticVariant, number>;

type SummonTriggerOperationKind =
  | "specialSummonDeckCostLabelDamage"
  | "specialSummonDamageStatExtraSummon"
  | "summonDraw"
  | "summonMassDestroy"
  | "summonSearch"
  | "summonSearchDiscard"
  | "summonSearchSelfSummon"
  | "summonSelfDestroy"
  | "summonSetFlipToHand"
  | "summonSuccessDeckSpecialSummon"
  | "summonSuccessFieldHandSelfSummon"
  | "summonSuccessHandSpecialSummon"
  | "summonToGraveGraveyardRevive"
  | "summonStepReviveDisable"
  | "summonToGraveDeckSummon"
  | "summonToDeck"
  | "summonTargetDestroy"
  | "summonTargetLevelUpdate"
  | "summonToHandBounce";
type SummonTriggerOperationSemanticVariant =
  | "aratamaSpiritSearchOnSummon"
  | "ashokaPillarSearchPositionDamage"
  | "blackwingNothungSummonDamageStatExtraSummon"
  | "backupIgnisterSearchDiscardOnSummon"
  | "crashbugZSummonSuccessDeckSpecialSummon"
  | "craneCraneStepReviveDisableOnSummon"
  | "cyberDinosaurOpponentHandSummon"
  | "darkDustSpiritMassDestroyOnSummon"
  | "driangleDeckDiscardLabelDamage"
  | "flameArmorNinjaSummonLevelUpdate"
  | "floowandereezeRobinaSearchNormalSummon"
  | "gemArmadilloNormalSummonSearch"
  | "gemKnightObsidianHandToGraveyardRevive"
  | "gishkiNataliaGraveToDeckTopOnSummon"
  | "gorgonicGargoyleRockSummon"
  | "golemSentryTurnSetFlipReturn"
  | "hanShiKyudoColumnReturnOnSummon"
  | "ichikiSayoriHimeEffectSummonSearch"
  | "izanamiDiscardGraveSpiritReturnOnSummon"
  | "moonlitPapillonToGraveDeckSummon"
  | "nuviaSummonSelfDestroyFieldCountStat"
  | "rGenexMagmaLevelSetSearch"
  | "rGenexOverseerClonedSummonHandSpecialSummon"
  | "senjuClonedSummonRitualMonsterSearch"
  | "shinobaronessShadePeacockSearchSelfSummon"
  | "shinobirdCraneDrawOnSpiritSummon"
  | "swarmScarabsFlipSummonTargetDestroy"
  | "yakshaBackrowReturnOnSummon";

describe("Lua real summon-trigger operation restore coverage", () => {
  it("requires summon-trigger operations to assert clean Lua registry restore and restored operation metadata", () => {
    const files = summonTriggerOperationFixtureFiles();
    expect(files).toHaveLength(summonTriggerOperationFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("eventHistory")
          || !text.includes("operationInfos")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps summon-trigger operation fixture kinds explicit", () => {
    expect(countSummonTriggerOperationKinds(summonTriggerOperationFixtureFiles())).toEqual(summonTriggerOperationKindCounts);
  });

  it("keeps named summon-trigger operation semantic variants explicit", () => {
    expect(countSummonTriggerOperationSemanticVariants(summonTriggerOperationSemanticVariants())).toEqual(
      summonTriggerOperationSemanticVariantCounts,
    );

    const weak = summonTriggerOperationSemanticVariants()
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function summonTriggerOperationFixtureFiles(): Array<{
  file: string;
  kind: SummonTriggerOperationKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-blackwing-nothung-summon-damage-stat-extra.test.ts",
      kind: "specialSummonDamageStatExtraSummon",
      required: [
        "restores its Special Summon damage/stat trigger and field extra Blackwing Normal Summon",
        'const nothungCode = "95040215"',
        "e1:SetCategory(CATEGORY_DAMAGE+CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)",
        "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "Duel.BreakEffect()",
        "e2:SetCode(EFFECT_EXTRA_SUMMON_COUNT)",
        "aux.TargetBoolFunction(Card.IsSetCard,SET_BLACKWING)",
        'eventName: "specialSummoned"',
        'eventName: "damageDealt"',
        "operationInfos",
        "category: 0x80000",
        "category: 0x200000",
        "category: 0x400000",
        "currentAttack(restoredChain.session.state.cards.find((card) => card.uid === target.uid), restoredChain.session.state)).toBe(700)",
        "currentDefense(restoredChain.session.state.cards.find((card) => card.uid === target.uid), restoredChain.session.state)).toBe(700)",
        "normalSummonAvailable).toBe(false)",
        "activityCounts[0].normalSummon).toBe(2)",
      ],
    },
    {
      file: "test/lua-real-script-driangle-deck-discard-label-damage.test.ts",
      kind: "specialSummonDeckCostLabelDamage",
      required: [
        "restores hand self-summon into deck-discard cost label, ATK gain, and effect damage",
        'const driangleCode = "98248208"',
        "Duel.IsPlayerCanDiscardDeckAsCost(tp,1)",
        "Duel.DiscardDeck(tp,1,REASON_COST)",
        "Duel.GetOperatedGroup():GetFirst():IsMonster() and 1 or 0",
        "e:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DAMAGE)",
        "Duel.Damage(1-tp,1000,REASON_EFFECT)",
        'eventName: "specialSummoned"',
        'eventName: "sentToGraveyard"',
        'eventName: "damageDealt"',
        "effectLabel: 1",
        "eventReason: duelReason.cost",
        "currentAttack(restoredDamageChain.session.state.cards.find((card) => card.uid === driangle.uid), restoredDamageChain.session.state)).toBe",
      ],
    },
    {
      file: "test/lua-real-script-cyber-dinosaur-opponent-hand-summon.test.ts",
      kind: "summonSuccessFieldHandSelfSummon",
      required: [
        "restores opponent hand Special Summon trigger into Cyber Dinosaur self summon",
        'const cyberDinosaurCode = "39439590"',
        "e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)",
        "e1:SetRange(LOCATION_HAND)",
        "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "return c:IsSummonPlayer(1-tp) and c:IsPreviousLocation(LOCATION_HAND)",
        "eg:IsExists(s.cfilter,1,nil,tp)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)",
        "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)",
        'triggerBucket: "opponentOptional"',
        'activationLocation: "hand"',
        'eventName: "specialSummoned"',
        "eventReasonCardUid: cyberDinosaur.uid",
        "eventReasonEffectId: 1",
      ],
    },
    {
      file: "test/lua-real-script-gorgonic-gargoyle-rock-summon.test.ts",
      kind: "summonSuccessFieldHandSelfSummon",
      required: [
        "restores Rock Normal Summon field trigger into hand self Special Summon",
        "does not trigger from a non-Rock Normal Summon",
        'const gargoyleCode = "64379261"',
        "e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_O)",
        "e1:SetRange(LOCATION_HAND)",
        "e1:SetCode(EVENT_SUMMON_SUCCESS)",
        "return ep==tp and eg:GetFirst():IsRace(RACE_ROCK)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)",
        "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)",
        'triggerBucket: "turnOptional"',
        'eventName: "normalSummoned"',
        'eventName: "specialSummoned"',
        "eventReasonCardUid: gargoyle.uid",
        "eventReasonEffectId: 1",
      ],
    },
    {
      file: "test/lua-real-script-flame-armor-ninja-summon-level.test.ts",
      kind: "summonTargetLevelUpdate",
      required: [
        "restores cloned summon-success target prompt into a Ninja EFFECT_UPDATE_LEVEL boost",
        'const flameArmorNinjaCode = "33034646"',
        "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)",
        "e1:SetCode(EVENT_SUMMON_SUCCESS)",
        "e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)",
        "e3:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)",
        "e1:SetCode(EFFECT_UPDATE_LEVEL)",
        "e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)",
        "e1:SetValue(1)",
        'triggerBucket: "turnOptional"',
        'eventName: "normalSummoned"',
        "operationInfos).toBeUndefined()",
        "flame armor ninja level 4",
      ],
    },
    {
      file: "test/lua-real-script-ashoka-pillar-search-position-damage.test.ts",
      kind: "summonSearch",
      required: [
        "restores its summon search, possible position operation, and destroyed self-damage trigger",
        'const ashokaCode = "58996839"',
        "Duel.SetPossibleOperationInfo(0,CATEGORY_POSITION,e:GetHandler(),1,0,0)",
        "Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)",
        "Duel.BreakEffect()",
        "Duel.ChangePosition(c,POS_FACEUP_DEFENSE)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        'eventName === "damageDealt"',
        "possibleOperationInfos",
        "category: 0x8",
        "category: 0x1000",
        "category: 0x80000",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-backup-ignister-summon-search-discard.test.ts",
      kind: "summonSearchDiscard",
      required: [
        "restores summon-success DARK Cyberse search, confirmation, hand shuffle, BreakEffect, and discard",
        'const backupCode = "30118811"',
        "return c:IsRace(RACE_CYBERSE) and c:IsSummonLocation(LOCATION_EXTRA) and c:IsFaceup()",
        "Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)",
        "Duel.ConfirmCards(1-tp,sc)",
        "Duel.ShuffleHand(tp)",
        "Duel.BreakEffect()",
        "Duel.DiscardHand(tp,nil,1,1,REASON_EFFECT|REASON_DISCARD,nil)",
        "category: 0x8",
        "category: 0x80",
        'eventName: "sentToHand"',
        'eventName: "sentToGraveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-crane-crane-step-summon-disable.test.ts",
      kind: "summonStepReviveDisable",
      required: [
        "restores summon-success target revive through SpecialSummonStep and disables the revived monster",
        "expectCleanRestore(restoredSummonWindow)",
        "expectCleanRestore(restoredTriggerWindow)",
        "expectCleanRestore(restoredChainWindow)",
        "expectRestoredLegalActions(restoredSummonWindow, 0)",
        "expectRestoredLegalActions(restoredTriggerWindow, 0)",
        "expectRestoredLegalActions(restoredChainWindow, 1)",
        'eventName: "normalSummoned"',
        'eventName: "specialSummoned"',
        "category: 0x200",
        "toEqual([2, 8])",
        "isCardDisabled",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-moonlit-papillon-to-grave-deck-summon.test.ts",
      kind: "summonToGraveDeckSummon",
      required: [
        "restores its Damage Step EVENT_TO_GRAVE trigger and Special Summons a Butterspy from Deck",
        "expectCleanRestore(restoredBattle)",
        "expectCleanRestore(restoredTrigger)",
        "expectRestoredLegalActions(restoredBattle, 1)",
        "expectRestoredLegalActions(restoredTrigger, 0)",
        'eventName: "sentToGraveyard"',
        'eventName: "specialSummoned"',
        "category: 0x200",
        "operationInfos",
        "setButterspy",
      ],
    },
    {
      file: "test/lua-real-script-gem-knight-obsidian-to-grave-revive.test.ts",
      kind: "summonToGraveGraveyardRevive",
      required: [
        "restores hand-to-Graveyard trigger targeting a Normal Monster in the Graveyard",
        'const obsidianCode = "19163116"',
        "return e:GetHandler():GetPreviousLocation()==LOCATION_HAND",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,e,tp)",
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
        "expectCleanRestore(restoredTrigger)",
        "expectCleanRestore(restoredChain)",
        "expectRestoredLegalActions(restoredTrigger, 0)",
        "expectRestoredLegalActions(restoredChain, 1)",
        'eventName: "sentToGraveyard"',
        'eventName === "specialSummoned"',
        "operationInfos",
        "category: 0x200",
        "targetUids: [normalTarget.uid]",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-r-genex-overseer-summon-hand-special.test.ts",
      kind: "summonSuccessHandSpecialSummon",
      required: [
        "restores cloned summon triggers into a selected low-level Genex hand Special Summon",
        'const overseerCode = "32744558"',
        "e1:SetCode(EVENT_SUMMON_SUCCESS)",
        "e2:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil,e,tp)",
        "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
        'eventName: kind === "normal" ? "normalSummoned" : "specialSummoned"',
        'eventName === "specialSummoned"',
        "operationInfos: [{ category: 0x200",
        "parameter: 0x2",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
      kind: "summonDraw",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName": "normalSummoned"',
        'eventName: "cardsDrawn"',
        "category: 65536",
        "targetParam: 1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-nuvia-summon-self-destroy-stat.test.ts",
      kind: "summonSelfDestroy",
      required: [
        "restores summon-success self destruction and opponent monster-count ATK loss",
        'const nuviaCode = "12953226"',
        "Duel.SetOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,0,0)",
        "Duel.Destroy(e:GetHandler(),REASON_EFFECT)",
        "Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)*-200",
        'eventName: "normalSummoned"',
        'eventName: "destroyed"',
        "operationInfos: [{ category: 0x1",
        "currentAttack(restoredNuviaAfterSummon, restoredSummonWindow.session.state)).toBe((nuvia.data.attack ?? 0) - 400)",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-dark-dust-spirit-destroy.test.ts",
      kind: "summonMassDestroy",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "destroyed"',
        "category: 0x1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-aratama-spirit-search.test.ts",
      kind: "summonSearch",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName": "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-izanami-spirit-grave-return.test.ts",
      kind: "summonSearch",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName": "normalSummoned"',
        'eventName: "discarded"',
        'eventName: "sentToHand"',
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-gem-armadillo-summon-search.test.ts",
      kind: "summonSearch",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSearchChain.missingRegistryKeys).toEqual([])",
        "restoredSearchChain.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-r-genex-magma-summon-search.test.ts",
      kind: "summonSearch",
      required: [
        "restores EVENT_SUMMON_SUCCESS Level 2 R-Genex Deck search-to-hand and confirmation",
        'const magmaCode = "1533292"',
        "return c:GetLevel()==2 and c:IsSetCard(SET_R_GENEX) and c:IsAbleToHand()",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-crashbug-z-summon-success-deck-summon.test.ts",
      kind: "summonSuccessDeckSpecialSummon",
      required: [
        "restores summon-success face-up Crashbug X condition into Crashbug Y Deck Special Summon",
        'const crashbugZCode = "50319138"',
        "return Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_ONFIELD,0,1,nil)",
        "Duel.GetFirstMatchingCard(s.spfilter,tp,LOCATION_DECK,0,nil,e,tp)",
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
        'eventName: "normalSummoned"',
        'eventName: "specialSummoned"',
        "operationInfos: [{ category: 0x200",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-floowandereeze-robina-search-normal.test.ts",
      kind: "summonSearch",
      required: [
        "restores summon-success search, special-summon oath cost, and optional follow-up Normal Summon",
        'const robinaCode = "18940725"',
        "Duel.GetActivityCount(tp,ACTIVITY_SPSUMMON)==0",
        "e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)",
        "return c:IsLevelBelow(4) and c:IsRace(RACE_WINGEDBEAST) and c:IsAbleToHand()",
        "Duel.SelectYesNo(tp,aux.Stringid(id,3))",
        "Duel.BreakEffect()",
        "Duel.ShuffleHand(tp)",
        "Duel.Summon(tp,sg2,true,nil)",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
        "effect.code === 22",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-ichiki-sayori-hime-effect-summon-search.test.ts",
      kind: "summonSearch",
      required: [
        "restoredOpenWindow.missingRegistryKeys).toEqual([])",
        "restoredOpenWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSummonChain.missingRegistryKeys).toEqual([])",
        "restoredSummonChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSearchChain.missingRegistryKeys).toEqual([])",
        "restoredSearchChain.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 256",
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-senju-summon-ritual-monster-search.test.ts",
      kind: "summonSearch",
      required: [
        "restores its cloned summon trigger and searches only Ritual Monsters",
        'const senjuCode = "23401839"',
        "local e2=e1:Clone()",
        "e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)",
        "return c:IsRitualMonster() and c:IsAbleToHand()",
        'eventName: "normalSummoned"',
        "operationInfos: [{ category: 0x8",
        'eventName: "sentToHandConfirmed"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-shinobaroness-shade-peacock-search-self-summon.test.ts",
      kind: "summonSearchSelfSummon",
      required: [
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSearchChain.missingRegistryKeys).toEqual([])",
        "restoredSearchChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredDraw.missingRegistryKeys).toEqual([])",
        "restoredDraw.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSelfSummonTrigger.missingRegistryKeys).toEqual([])",
        "restoredSelfSummonTrigger.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSelfSummonChain.missingRegistryKeys).toEqual([])",
        "restoredSelfSummonChain.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "specialSummoned"',
        'eventName: "sentToHand"',
        'eventName: "phaseStandby"',
        "category: 8",
        "category: 512",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-swarm-scarabs-turn-set-flip-destroy.test.ts",
      kind: "summonTargetDestroy",
      required: [
        "restores its ignition turn-set flag and flip-summon mandatory targeted destruction",
        'const swarmCode = "15383415"',
        "e1:SetCategory(CATEGORY_POSITION+CATEGORY_SET)",
        "c:RegisterFlagEffect(id,RESET_EVENT|(RESETS_STANDARD_PHASE_END&~RESET_TURN_SET),0,1)",
        "Duel.ChangePosition(c,POS_FACEDOWN_DEFENSE)",
        "e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)",
        "Duel.SelectTarget(tp,aux.TRUE,tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.Destroy(tc,REASON_EFFECT)",
        'eventName: "flipSummoned"',
        'eventName: "destroyed"',
        'eventName === "positionChanged"',
        "operationInfos",
        "category: 0x1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-golem-sentry-turn-set-flip-to-hand.test.ts",
      kind: "summonSetFlipToHand",
      required: [
        "restores ignition turn-set flag and flip-summon mandatory target return",
        'const golemCode = "52323207"',
        "e1:SetCategory(CATEGORY_POSITION+CATEGORY_SET)",
        "c:RegisterFlagEffect(id,RESET_EVENT|(RESETS_STANDARD_PHASE_END&~RESET_TURN_SET),0,1)",
        "Duel.ChangePosition(c,POS_FACEDOWN_DEFENSE)",
        "e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)",
        "Duel.SelectTarget(tp,Card.IsAbleToHand,tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.SendtoHand(tc,nil,REASON_EFFECT)",
        'eventName: "flipSummoned"',
        'eventName: "sentToHand"',
        'eventName === "positionChanged"',
        "operationInfos",
        "category: 0x8",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-yaksha-spirit-backrow-return.test.ts",
      kind: "summonToHandBounce",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "targetUids",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-han-shi-kyudo-spirit-column-return.test.ts",
      kind: "summonToHandBounce",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "possibleOperationInfos",
        "targetUids",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-gishki-natalia-spirit-to-deck.test.ts",
      kind: "summonToDeck",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToDeck"',
        "category: 16",
        "targetUids",
        "host.messages).not.toContain",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonTriggerOperationKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function summonTriggerOperationSemanticVariants(): Array<{
  file: string;
  kind: SummonTriggerOperationSemanticVariant;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-aratama-spirit-search.test.ts",
      kind: "aratamaSpiritSearchOnSummon",
      requiredSnippets: [
        'const aratamaCode = "16889337"',
        "restores its summon trigger and searches a Spirit monster from Deck",
        'eventName: "sentToHand"',
      ],
    },
    {
      file: "test/lua-real-script-ashoka-pillar-search-position-damage.test.ts",
      kind: "ashokaPillarSearchPositionDamage",
      requiredSnippets: [
        'const ashokaCode = "58996839"',
        "restores its summon search, possible position operation, and destroyed self-damage trigger",
        "Duel.SetPossibleOperationInfo(0,CATEGORY_POSITION,e:GetHandler(),1,0,0)",
        "Duel.BreakEffect()",
        "Duel.ChangePosition(c,POS_FACEUP_DEFENSE)",
        "Duel.SetTargetParam(2000)",
      ],
    },
    {
      file: "test/lua-real-script-backup-ignister-summon-search-discard.test.ts",
      kind: "backupIgnisterSearchDiscardOnSummon",
      requiredSnippets: [
        'const backupCode = "30118811"',
        "restores Extra Deck Cyberse-gated hand Special Summon",
        "restores summon-success DARK Cyberse search, confirmation, hand shuffle, BreakEffect, and discard",
        "Duel.BreakEffect()",
        'eventName: "sentToHand"',
        'eventName: "sentToGraveyard"',
      ],
    },
    {
      file: "test/lua-real-script-blackwing-nothung-summon-damage-stat-extra.test.ts",
      kind: "blackwingNothungSummonDamageStatExtraSummon",
      requiredSnippets: [
        'const nothungCode = "95040215"',
        "restores its Special Summon damage/stat trigger and field extra Blackwing Normal Summon",
        "Duel.SetTargetParam(800)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "e2:SetCode(EFFECT_EXTRA_SUMMON_COUNT)",
        "currentAttack(restoredChain.session.state.cards.find((card) => card.uid === target.uid), restoredChain.session.state)).toBe(700)",
        "activityCounts[0].normalSummon).toBe(2)",
      ],
    },
    {
      file: "test/lua-real-script-driangle-deck-discard-label-damage.test.ts",
      kind: "driangleDeckDiscardLabelDamage",
      requiredSnippets: [
        'const driangleCode = "98248208"',
        "restores hand self-summon into deck-discard cost label, ATK gain, and effect damage",
        "Duel.GetOperatedGroup():GetFirst():IsMonster() and 1 or 0",
        "effectLabel: 1",
        'eventName: "damageDealt"',
      ],
    },
    {
      file: "test/lua-real-script-crane-crane-step-summon-disable.test.ts",
      kind: "craneCraneStepReviveDisableOnSummon",
      requiredSnippets: [
        'const craneCode = "28637168"',
        "restores summon-success target revive through SpecialSummonStep and disables the revived monster",
        'eventName: "specialSummoned"',
        "toEqual([2, 8])",
        "isCardDisabled",
      ],
    },
    {
      file: "test/lua-real-script-cyber-dinosaur-opponent-hand-summon.test.ts",
      kind: "cyberDinosaurOpponentHandSummon",
      requiredSnippets: [
        'const cyberDinosaurCode = "39439590"',
        "restores opponent hand Special Summon trigger into Cyber Dinosaur self summon",
        "return c:IsSummonPlayer(1-tp) and c:IsPreviousLocation(LOCATION_HAND)",
        'triggerBucket: "opponentOptional"',
        'activationLocation: "hand"',
        "eventReasonCardUid: cyberDinosaur.uid",
      ],
    },
    {
      file: "test/lua-real-script-dark-dust-spirit-destroy.test.ts",
      kind: "darkDustSpiritMassDestroyOnSummon",
      requiredSnippets: [
        'const darkDustCode = "89111398"',
        "restores its Spirit summon trigger and destroys all other face-up monsters",
        'eventName: "destroyed"',
      ],
    },
    {
      file: "test/lua-real-script-flame-armor-ninja-summon-level.test.ts",
      kind: "flameArmorNinjaSummonLevelUpdate",
      requiredSnippets: [
        'const flameArmorNinjaCode = "33034646"',
        "restores cloned summon-success target prompt into a Ninja EFFECT_UPDATE_LEVEL boost",
        "return c:IsFaceup() and c:GetLevel()~=0 and c:IsSetCard(SET_NINJA)",
        'triggerBucket: "turnOptional"',
        'eventName: "normalSummoned"',
        "targetUids: [ninjaTarget.uid]",
        "flame armor ninja level 4",
      ],
    },
    {
      file: "test/lua-real-script-floowandereeze-robina-search-normal.test.ts",
      kind: "floowandereezeRobinaSearchNormalSummon",
      requiredSnippets: [
        'const robinaCode = "18940725"',
        "restores summon-success search, special-summon oath cost, and optional follow-up Normal Summon",
        "Duel.GetActivityCount(tp,ACTIVITY_SPSUMMON)==0",
        "Duel.SelectYesNo(tp,aux.Stringid(id,3))",
        "Duel.Summon(tp,sg2,true,nil)",
        'eventName: "normalSummoned"',
        'api: "SelectYesNo"',
        "effect.code === 22",
      ],
    },
    {
      file: "test/lua-real-script-gem-armadillo-summon-search.test.ts",
      kind: "gemArmadilloNormalSummonSearch",
      requiredSnippets: [
        'const gemArmadilloCode = "27004302"',
        "restores EVENT_SUMMON_SUCCESS Deck search-to-hand and confirmation",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
      ],
    },
    {
      file: "test/lua-real-script-r-genex-magma-summon-search.test.ts",
      kind: "rGenexMagmaLevelSetSearch",
      requiredSnippets: [
        'const magmaCode = "1533292"',
        "restores EVENT_SUMMON_SUCCESS Level 2 R-Genex Deck search-to-hand and confirmation",
        "return c:GetLevel()==2 and c:IsSetCard(SET_R_GENEX) and c:IsAbleToHand()",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
      ],
    },
    {
      file: "test/lua-real-script-crashbug-z-summon-success-deck-summon.test.ts",
      kind: "crashbugZSummonSuccessDeckSpecialSummon",
      requiredSnippets: [
        'const crashbugZCode = "50319138"',
        "return c:IsFaceup() and c:IsCode(87526784)",
        "return c:IsCode(23915499) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)",
        'triggerBucket: "turnOptional"',
        "eventReasonCardUid: crashbugZ.uid",
      ],
    },
    {
      file: "test/lua-real-script-gem-knight-obsidian-to-grave-revive.test.ts",
      kind: "gemKnightObsidianHandToGraveyardRevive",
      requiredSnippets: [
        'const obsidianCode = "19163116"',
        "restores hand-to-Graveyard trigger targeting a Normal Monster in the Graveyard",
        'eventName: "sentToGraveyard"',
        'eventName === "specialSummoned"',
        "targetUids: [normalTarget.uid]",
      ],
    },
    {
      file: "test/lua-real-script-gishki-natalia-spirit-to-deck.test.ts",
      kind: "gishkiNataliaGraveToDeckTopOnSummon",
      requiredSnippets: [
        'const nataliaCode = "17241370"',
        "restores its summon trigger and returns a targeted Gishki monster from the Graveyard to the Deck top",
        'eventName: "sentToDeck"',
      ],
    },
    {
      file: "test/lua-real-script-gorgonic-gargoyle-rock-summon.test.ts",
      kind: "gorgonicGargoyleRockSummon",
      requiredSnippets: [
        'const gargoyleCode = "64379261"',
        "restores Rock Normal Summon field trigger into hand self Special Summon",
        "does not trigger from a non-Rock Normal Summon",
        "return ep==tp and eg:GetFirst():IsRace(RACE_ROCK)",
        'triggerBucket: "turnOptional"',
        "eventReasonCardUid: gargoyle.uid",
      ],
    },
    {
      file: "test/lua-real-script-han-shi-kyudo-spirit-column-return.test.ts",
      kind: "hanShiKyudoColumnReturnOnSummon",
      requiredSnippets: [
        'const hanShiCode = "53270092"',
        "restores its summon trigger and returns Pendulum Zone columns to hand without resolving the responder",
        "possibleOperationInfos",
      ],
    },
    {
      file: "test/lua-real-script-ichiki-sayori-hime-effect-summon-search.test.ts",
      kind: "ichikiSayoriHimeEffectSummonSearch",
      requiredSnippets: [
        'const ichikiCode = "9627299"',
        "restores its hand ignition Normal Summon and summon-trigger 800-stat Deck search",
        "category: 256",
        "category: 8",
      ],
    },
    {
      file: "test/lua-real-script-izanami-spirit-grave-return.test.ts",
      kind: "izanamiDiscardGraveSpiritReturnOnSummon",
      requiredSnippets: [
        'const izanamiCode = "43543777"',
        "restores its summon trigger discard cost, Graveyard Spirit target, and confirm-to-hand resolution",
        'eventName: "discarded"',
        'eventName: "sentToHand"',
      ],
    },
    {
      file: "test/lua-real-script-moonlit-papillon-to-grave-deck-summon.test.ts",
      kind: "moonlitPapillonToGraveDeckSummon",
      requiredSnippets: [
        'const papillonCode = "16366944"',
        "restores its Damage Step EVENT_TO_GRAVE trigger and Special Summons a Butterspy from Deck",
        'eventName: "sentToGraveyard"',
        'eventName: "specialSummoned"',
        "setButterspy",
      ],
    },
    {
      file: "test/lua-real-script-nuvia-summon-self-destroy-stat.test.ts",
      kind: "nuviaSummonSelfDestroyFieldCountStat",
      requiredSnippets: [
        'const nuviaCode = "12953226"',
        "restores summon-success self destruction and opponent monster-count ATK loss",
        "Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)*-200",
        'triggerBucket: "turnMandatory"',
        "eventReasonCardUid: nuvia.uid",
        "eventReasonEffectId: 1",
      ],
    },
    {
      file: "test/lua-real-script-r-genex-overseer-summon-hand-special.test.ts",
      kind: "rGenexOverseerClonedSummonHandSpecialSummon",
      requiredSnippets: [
        'const overseerCode = "32744558"',
        "restores cloned summon triggers into a selected low-level Genex hand Special Summon",
        "return c:IsSetCard(SET_GENEX) and c:GetLevel()<=3",
        'eventName: kind === "normal" ? "normalSummoned" : "specialSummoned"',
        'eventName === "specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-senju-summon-ritual-monster-search.test.ts",
      kind: "senjuClonedSummonRitualMonsterSearch",
      requiredSnippets: [
        'const senjuCode = "23401839"',
        "restores its cloned summon trigger and searches only Ritual Monsters",
        "e2:SetCode(EVENT_FLIP_SUMMON_SUCCESS)",
        "return c:IsRitualMonster() and c:IsAbleToHand()",
        'eventName: "sentToHandConfirmed"',
      ],
    },
    {
      file: "test/lua-real-script-shinobaroness-shade-peacock-search-self-summon.test.ts",
      kind: "shinobaronessShadePeacockSearchSelfSummon",
      requiredSnippets: [
        'const shadeCode = "33325951"',
        "restores its Ritual-summoned search trigger and banished next-Standby self Special Summon",
        'eventName: "phaseStandby"',
        "category: 512",
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
      kind: "shinobirdCraneDrawOnSpiritSummon",
      requiredSnippets: [
        'const craneCode = "66815913"',
        "restores its field trigger when another Spirit monster is Summoned and draws 1 card",
        'eventName: "cardsDrawn"',
      ],
    },
    {
      file: "test/lua-real-script-swarm-scarabs-turn-set-flip-destroy.test.ts",
      kind: "swarmScarabsFlipSummonTargetDestroy",
      requiredSnippets: [
        'const swarmCode = "15383415"',
        "restores its ignition turn-set flag and flip-summon mandatory targeted destruction",
        "c:GetFlagEffect(id)==0",
        "Duel.SetOperationInfo(0,CATEGORY_POSITION,c,1,tp,POS_FACEDOWN_DEFENSE)",
        'eventName === "positionChanged"',
        'eventName: "flipSummoned"',
        'eventName: "destroyed"',
        "eventReasonEffectId: 2",
      ],
    },
    {
      file: "test/lua-real-script-golem-sentry-turn-set-flip-to-hand.test.ts",
      kind: "golemSentryTurnSetFlipReturn",
      requiredSnippets: [
        'const golemCode = "52323207"',
        "restores ignition turn-set flag and flip-summon mandatory target return",
        "c:GetFlagEffect(id)==0",
        "Duel.SetOperationInfo(0,CATEGORY_POSITION,c,1,tp,POS_FACEDOWN_DEFENSE)",
        "Duel.SelectTarget(tp,Card.IsAbleToHand,tp,0,LOCATION_MZONE,1,1,nil)",
        'eventName === "positionChanged"',
        'eventName: "flipSummoned"',
        'eventName: "sentToHand"',
        "eventReasonEffectId: 2",
      ],
    },
    {
      file: "test/lua-real-script-yaksha-spirit-backrow-return.test.ts",
      kind: "yakshaBackrowReturnOnSummon",
      requiredSnippets: [
        'const yakshaCode = "94215860"',
        "restores its summon trigger and returns one opponent Spell/Trap to hand",
        "targetUids",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonTriggerOperationSemanticVariant;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSummonTriggerOperationKinds(
  fixtures: Array<{ kind: SummonTriggerOperationKind }>,
): Record<SummonTriggerOperationKind, number> {
  return fixtures.reduce<Record<SummonTriggerOperationKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      specialSummonDeckCostLabelDamage: 0,
      specialSummonDamageStatExtraSummon: 0,
      summonDraw: 0,
      summonMassDestroy: 0,
      summonSearch: 0,
      summonSearchDiscard: 0,
      summonSearchSelfSummon: 0,
      summonSelfDestroy: 0,
      summonSetFlipToHand: 0,
      summonSuccessDeckSpecialSummon: 0,
      summonSuccessFieldHandSelfSummon: 0,
      summonSuccessHandSpecialSummon: 0,
      summonToGraveGraveyardRevive: 0,
      summonStepReviveDisable: 0,
      summonToGraveDeckSummon: 0,
      summonToDeck: 0,
      summonTargetDestroy: 0,
      summonTargetLevelUpdate: 0,
      summonToHandBounce: 0,
    },
  );
}

function countSummonTriggerOperationSemanticVariants(
  fixtures: Array<{ kind: SummonTriggerOperationSemanticVariant }>,
): Record<SummonTriggerOperationSemanticVariant, number> {
  return fixtures.reduce<Record<SummonTriggerOperationSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      aratamaSpiritSearchOnSummon: 0,
      ashokaPillarSearchPositionDamage: 0,
      blackwingNothungSummonDamageStatExtraSummon: 0,
      backupIgnisterSearchDiscardOnSummon: 0,
      crashbugZSummonSuccessDeckSpecialSummon: 0,
      craneCraneStepReviveDisableOnSummon: 0,
      cyberDinosaurOpponentHandSummon: 0,
      darkDustSpiritMassDestroyOnSummon: 0,
      driangleDeckDiscardLabelDamage: 0,
      flameArmorNinjaSummonLevelUpdate: 0,
      floowandereezeRobinaSearchNormalSummon: 0,
      gemArmadilloNormalSummonSearch: 0,
      gemKnightObsidianHandToGraveyardRevive: 0,
      gishkiNataliaGraveToDeckTopOnSummon: 0,
      gorgonicGargoyleRockSummon: 0,
      golemSentryTurnSetFlipReturn: 0,
      hanShiKyudoColumnReturnOnSummon: 0,
      ichikiSayoriHimeEffectSummonSearch: 0,
      izanamiDiscardGraveSpiritReturnOnSummon: 0,
      moonlitPapillonToGraveDeckSummon: 0,
      nuviaSummonSelfDestroyFieldCountStat: 0,
      rGenexMagmaLevelSetSearch: 0,
      rGenexOverseerClonedSummonHandSpecialSummon: 0,
      senjuClonedSummonRitualMonsterSearch: 0,
      shinobaronessShadePeacockSearchSelfSummon: 0,
      shinobirdCraneDrawOnSpiritSummon: 0,
      swarmScarabsFlipSummonTargetDestroy: 0,
      yakshaBackrowReturnOnSummon: 0,
    },
  );
}
