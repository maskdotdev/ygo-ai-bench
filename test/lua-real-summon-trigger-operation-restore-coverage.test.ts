import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const summonTriggerOperationFixtureCount = 17;
const summonTriggerOperationKindCounts = {
  summonDraw: 1,
  summonMassDestroy: 1,
  summonSearch: 6,
  summonSearchSelfSummon: 1,
  summonSuccessHandSpecialSummon: 1,
  summonToGraveGraveyardRevive: 1,
  summonStepReviveDisable: 1,
  summonToGraveDeckSummon: 1,
  summonToDeck: 1,
  summonTargetDestroy: 1,
  summonToHandBounce: 2,
} satisfies Record<SummonTriggerOperationKind, number>;
const summonTriggerOperationSemanticVariantCounts = {
  aratamaSpiritSearchOnSummon: 1,
  ashokaPillarSearchPositionDamage: 1,
  craneCraneStepReviveDisableOnSummon: 1,
  darkDustSpiritMassDestroyOnSummon: 1,
  gemArmadilloNormalSummonSearch: 1,
  gemKnightObsidianHandToGraveyardRevive: 1,
  gishkiNataliaGraveToDeckTopOnSummon: 1,
  hanShiKyudoColumnReturnOnSummon: 1,
  ichikiSayoriHimeEffectSummonSearch: 1,
  izanamiDiscardGraveSpiritReturnOnSummon: 1,
  moonlitPapillonToGraveDeckSummon: 1,
  rGenexOverseerClonedSummonHandSpecialSummon: 1,
  senjuClonedSummonRitualMonsterSearch: 1,
  shinobaronessShadePeacockSearchSelfSummon: 1,
  shinobirdCraneDrawOnSpiritSummon: 1,
  yakshaBackrowReturnOnSummon: 1,
  swarmScarabsFlipSummonTargetDestroy: 1,
} satisfies Record<SummonTriggerOperationSemanticVariant, number>;

type SummonTriggerOperationKind =
  | "summonDraw"
  | "summonMassDestroy"
  | "summonSearch"
  | "summonSearchSelfSummon"
  | "summonSuccessHandSpecialSummon"
  | "summonToGraveGraveyardRevive"
  | "summonStepReviveDisable"
  | "summonToGraveDeckSummon"
  | "summonToDeck"
  | "summonTargetDestroy"
  | "summonToHandBounce";
type SummonTriggerOperationSemanticVariant =
  | "aratamaSpiritSearchOnSummon"
  | "ashokaPillarSearchPositionDamage"
  | "craneCraneStepReviveDisableOnSummon"
  | "darkDustSpiritMassDestroyOnSummon"
  | "gemArmadilloNormalSummonSearch"
  | "gemKnightObsidianHandToGraveyardRevive"
  | "gishkiNataliaGraveToDeckTopOnSummon"
  | "hanShiKyudoColumnReturnOnSummon"
  | "ichikiSayoriHimeEffectSummonSearch"
  | "izanamiDiscardGraveSpiritReturnOnSummon"
  | "moonlitPapillonToGraveDeckSummon"
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
      file: "test/lua-real-script-dark-dust-spirit-destroy.test.ts",
      kind: "darkDustSpiritMassDestroyOnSummon",
      requiredSnippets: [
        'const darkDustCode = "89111398"',
        "restores its Spirit summon trigger and destroys all other face-up monsters",
        'eventName: "destroyed"',
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
      summonDraw: 0,
      summonMassDestroy: 0,
      summonSearch: 0,
      summonSearchSelfSummon: 0,
      summonSuccessHandSpecialSummon: 0,
      summonToGraveGraveyardRevive: 0,
      summonStepReviveDisable: 0,
      summonToGraveDeckSummon: 0,
      summonToDeck: 0,
      summonTargetDestroy: 0,
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
      craneCraneStepReviveDisableOnSummon: 0,
      darkDustSpiritMassDestroyOnSummon: 0,
      gemArmadilloNormalSummonSearch: 0,
      gemKnightObsidianHandToGraveyardRevive: 0,
      gishkiNataliaGraveToDeckTopOnSummon: 0,
      hanShiKyudoColumnReturnOnSummon: 0,
      ichikiSayoriHimeEffectSummonSearch: 0,
      izanamiDiscardGraveSpiritReturnOnSummon: 0,
      moonlitPapillonToGraveDeckSummon: 0,
      rGenexOverseerClonedSummonHandSpecialSummon: 0,
      senjuClonedSummonRitualMonsterSearch: 0,
      shinobaronessShadePeacockSearchSelfSummon: 0,
      shinobirdCraneDrawOnSpiritSummon: 0,
      swarmScarabsFlipSummonTargetDestroy: 0,
      yakshaBackrowReturnOnSummon: 0,
    },
  );
}
