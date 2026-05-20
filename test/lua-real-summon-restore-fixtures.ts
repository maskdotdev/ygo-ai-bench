import fs from "node:fs";
import path from "node:path";
import { discardTriggerSpecialSummonFixtureCount, realScriptDiscardTriggerSpecialSummonFixtureSnippets } from "./lua-real-discard-trigger-special-summon-restore-fixtures.js";
import { realScriptForceMonsterZoneSummonLockFixtureSnippets } from "./lua-real-force-mzone-summon-restore-fixtures.js";
import { freeChainSpecialSummonFixtureCount, realScriptFreeChainSpecialSummonFixtureSnippets } from "./lua-real-free-chain-special-summon-restore-fixtures.js";
import { ignitionCostSpecialSummonFixtureCount, realScriptIgnitionCostSpecialSummonFixtureSnippets } from "./lua-real-ignition-cost-special-summon-restore-fixtures.js";
import { releaseCostSpecialSummonFixtureCount, realScriptReleaseCostSpecialSummonFixtureSnippets } from "./lua-real-release-cost-special-summon-restore-fixtures.js";
import { realScriptSummonSuccessSelfSpecialSummonFixtureSnippets, summonSuccessSelfSpecialSummonFixtureCount } from "./lua-real-summon-success-self-special-summon-restore-fixtures.js";
import { realScriptSummonSuccessTargetSpecialSummonFixtureSnippets, summonSuccessTargetSpecialSummonFixtureCount } from "./lua-real-summon-success-target-special-summon-restore-fixtures.js";

export const root = process.cwd();
export const testRoot = path.join(root, "test");
export const summonKeywords = ["summon", "fusion", "synchro", "xyz", "link", "ritual", "pendulum"];
const nonSummonKeywordFixtures = new Set([
  "lua-real-script-xyz-reversal-swap-control.test.ts",
]);
export const realScriptSummonFixtureCount = 264;
export const summonProcedureFixtureCount = 30;
export const typedSummonProcedureFixtureCount = 6;
export const pendulumGrantFixtureCount = 4;
export const pendulumHelperFixtureCount = 16;
export const unionProcedureFixtureCount = 4;
export const materialLockFixtureCount = 4;
export const flipSummonSuccessTrapFixtureCount = 4;
export const linkedZoneSpecialSummonFixtureCount = 5;
export const selfTributeZoneSpecialSummonFixtureCount = 3;
export const tributeMaterialFixtureCount = 1;
export const unsummonableSummonSetLockFixtureCount = 1;
export const realScriptSummonKeywordFamilyCounts = {
  fusion: 47,
  link: 19,
  pendulum: 20,
  ritual: 24,
  summon: 119,
  synchro: 19,
  xyz: 16,
} satisfies Record<RealScriptSummonKeywordFamily, number>;
export const summonProcedureFamilyCounts = {
  fusionProcedure: 1,
  genericSpecialSummonProcedure: 18,
  pendulumProcedure: 3,
  ritualProcedure: 3,
  tributeProcedure: 2,
  typedProcedureFilter: 3,
} satisfies Record<SummonProcedureFamily, number>;
export const typedSummonProcedureKindCounts = {
  fusionProcedure: 1,
  linkProcedure: 1,
  ritualProcedure: 2,
  synchroProcedure: 1,
  xyzProcedure: 1,
} satisfies Record<TypedSummonProcedureKind, number>;
export const pendulumHelperKindCounts = {
  directPendulumSummon: 1,
  extraDeckGrant: 3,
  extraSummonCountGrant: 2,
  filteredSetcodeGrant: 3,
  handGrant: 1,
  pendulumSummonLock: 3,
  procedureAction: 2,
  procedureNoScaleActivation: 1,
} satisfies Record<PendulumHelperKind, number>;
export const pendulumGrantKindCounts = {
  extraDeckLocationGrant: 1,
  extraSummonCountGrant: 1,
  opponentScaleGrant: 1,
  opponentScaleSelectionGrant: 1,
} satisfies Record<PendulumGrantKind, number>;
export const unionProcedureKindCounts = {
  battleTriggerSummonBack: 1,
  deckEquipBanish: 1,
  equipAndSummonBack: 1,
  equippedRitualSummon: 1,
} satisfies Record<SummonUnionProcedureKind, number>;
export const materialLockKindCounts = {
  fusionMaterialLock: 1,
  genericMaterialLock: 1,
  linkMaterialLock: 1,
  xyzMaterialLock: 1,
} satisfies Record<SummonMaterialLockKind, number>;
export const flipSummonSuccessTrapKindCounts = {
  flipBanishTrap: 1,
  flipDestroyTrap: 2,
  flipStatTrap: 1,
} satisfies Record<FlipSummonSuccessTrapKind, number>;
export const linkedZoneSpecialSummonKindCounts = {
  handTriggerLinkSummon: 1,
  linkedCountZoneSummon: 1,
  opponentFieldLinkedZoneSummon: 1,
  releaseCostDeckSummon: 1,
  toBeLinkedZoneRevive: 1,
} satisfies Record<LinkedZoneSpecialSummonKind, number>;
export const selfTributeZoneSpecialSummonKindCounts = {
  opponentTurnQuickSelfTributeDeckSummon: 1,
  selfTributeFreesMonsterZone: 1,
  selfTributeHandSummonFreesMonsterZone: 1,
} satisfies Record<SelfTributeZoneSpecialSummonKind, number>;
export const summonSemanticVariantCounts = {
  realScriptSummonKeywordCorpus: realScriptSummonFixtureCount,
  summonProcedureLegalWindows: summonProcedureFixtureCount,
  typedSummonProcedurePlacement: typedSummonProcedureFixtureCount,
  pendulumGrantConsumption: pendulumGrantFixtureCount,
  pendulumHelperGrantFilters: pendulumHelperFixtureCount,
  unionEquipAndSummonBackProcedures: unionProcedureFixtureCount,
  summonMaterialLockSuppression: materialLockFixtureCount,
  flipSummonSuccessTrapResponses: flipSummonSuccessTrapFixtureCount,
  linkedZoneSpecialSummons: linkedZoneSpecialSummonFixtureCount,
  selfTributeZoneSpecialSummons: selfTributeZoneSpecialSummonFixtureCount,
  releaseCostSpecialSummons: releaseCostSpecialSummonFixtureCount,
  freeChainSpecialSummons: freeChainSpecialSummonFixtureCount,
  ignitionCostSpecialSummons: ignitionCostSpecialSummonFixtureCount,
  discardTriggerSpecialSummons: discardTriggerSpecialSummonFixtureCount,
  summonSuccessTargetSpecialSummons: summonSuccessTargetSpecialSummonFixtureCount,
  summonSuccessSelfSpecialSummons: summonSuccessSelfSpecialSummonFixtureCount,
  tributeMaterialValuePredicates: tributeMaterialFixtureCount,
  unsummonableSummonSetLocks: unsummonableSummonSetLockFixtureCount,
  forceMonsterZoneSummonLocks: 4,
} satisfies Record<SummonSemanticVariant, number>;

export type SummonUnionProcedureKind =
  | "battleTriggerSummonBack"
  | "deckEquipBanish"
  | "equipAndSummonBack"
  | "equippedRitualSummon";

export type SummonMaterialLockKind =
  | "fusionMaterialLock"
  | "genericMaterialLock"
  | "linkMaterialLock"
  | "xyzMaterialLock";

export type FlipSummonSuccessTrapKind = "flipBanishTrap" | "flipDestroyTrap" | "flipStatTrap";
export type LinkedZoneSpecialSummonKind =
  | "handTriggerLinkSummon"
  | "linkedCountZoneSummon"
  | "opponentFieldLinkedZoneSummon"
  | "releaseCostDeckSummon"
  | "toBeLinkedZoneRevive";
export type SelfTributeZoneSpecialSummonKind =
  | "opponentTurnQuickSelfTributeDeckSummon"
  | "selfTributeFreesMonsterZone"
  | "selfTributeHandSummonFreesMonsterZone";
export type SummonSemanticVariant =
  | "realScriptSummonKeywordCorpus" | "summonProcedureLegalWindows" | "typedSummonProcedurePlacement" | "pendulumGrantConsumption" | "pendulumHelperGrantFilters" | "unionEquipAndSummonBackProcedures" | "summonMaterialLockSuppression" | "flipSummonSuccessTrapResponses" | "linkedZoneSpecialSummons" | "selfTributeZoneSpecialSummons" | "releaseCostSpecialSummons" | "freeChainSpecialSummons" | "ignitionCostSpecialSummons" | "discardTriggerSpecialSummons" | "summonSuccessTargetSpecialSummons" | "summonSuccessSelfSpecialSummons" | "tributeMaterialValuePredicates" | "unsummonableSummonSetLocks" | "forceMonsterZoneSummonLocks";
export type RealScriptSummonKeywordFamily =
  | "fusion"
  | "link"
  | "pendulum"
  | "ritual"
  | "summon"
  | "synchro"
  | "xyz";
export type SummonProcedureFamily =
  | "fusionProcedure"
  | "genericSpecialSummonProcedure"
  | "pendulumProcedure"
  | "ritualProcedure"
  | "tributeProcedure"
  | "typedProcedureFilter";
export type TypedSummonProcedureKind =
  | "fusionProcedure"
  | "linkProcedure"
  | "ritualProcedure"
  | "synchroProcedure"
  | "xyzProcedure";
export type PendulumHelperKind =
  | "directPendulumSummon"
  | "extraDeckGrant"
  | "extraSummonCountGrant"
  | "filteredSetcodeGrant"
  | "handGrant"
  | "pendulumSummonLock"
  | "procedureAction"
  | "procedureNoScaleActivation";
export type PendulumGrantKind =
  | "extraDeckLocationGrant"
  | "extraSummonCountGrant"
  | "opponentScaleGrant"
  | "opponentScaleSelectionGrant";

export function realScriptSummonFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.startsWith("lua-real-script-") && file.endsWith(".test.ts"))
    .filter((file) => !nonSummonKeywordFixtures.has(file))
    .filter((file) => summonKeywords.some((keyword) => file.includes(keyword)))
    .map((file) => path.join("test", file))
    .sort();
}

export function countRealScriptSummonKeywordFamilies(files: string[]): Record<RealScriptSummonKeywordFamily, number> {
  return files.reduce<Record<RealScriptSummonKeywordFamily, number>>(
    (counts, file) => {
      counts[classifyRealScriptSummonKeywordFamily(file)] += 1;
      return counts;
    },
    {
      fusion: 0,
      link: 0,
      pendulum: 0,
      ritual: 0,
      summon: 0,
      synchro: 0,
      xyz: 0,
    },
  );
}

export function classifyRealScriptSummonKeywordFamily(file: string): RealScriptSummonKeywordFamily {
  const basename = path.basename(file);
  if (basename.includes("fusion")) return "fusion";
  if (basename.includes("link")) return "link";
  if (basename.includes("pendulum")) return "pendulum";
  if (basename.includes("ritual")) return "ritual";
  if (basename.includes("synchro")) return "synchro";
  if (basename.includes("xyz")) return "xyz";
  if (basename.includes("summon")) return "summon";
  throw new Error(`Unclassified real-script summon fixture: ${file}`);
}

export function realScriptFlipSummonSuccessTrapFixtureSnippets(): Array<{
  file: string;
  kind: FlipSummonSuccessTrapKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-bottomless-trap-hole-summon-success.test.ts",
      kind: "flipBanishTrap",
      required: [
        'eventName: "flipSummoned"',
        'effectId).toContain("-1101"',
        'windowKind).toBe("chainResponse")',
        'type === "activateEffect"',
        'location: "banished"',
        "category: 0x4",
        "bottomless flip chain starter resolved",
      ],
    },
    {
      file: "test/lua-real-script-house-adhesive-tape-flip-summon.test.ts",
      kind: "flipDestroyTrap",
      required: [
        'eventName: "flipSummoned"',
        'effectId).toContain("-1101"',
        'windowKind).toBe("chainResponse")',
        'type === "activateEffect"',
        "house tape flip chain starter resolved",
      ],
    },
    {
      file: "test/lua-real-script-adhesion-trap-hole-flip-summon.test.ts",
      kind: "flipStatTrap",
      required: [
        'eventName: "flipSummoned"',
        'effectId).toContain("-1101"',
        'windowKind).toBe("chainResponse")',
        'type === "activateEffect"',
        "code === 103",
        "value: 500",
        "adhesion flip chain starter resolved",
      ],
    },
    {
      file: "test/lua-real-script-trap-hole-flip-summon.test.ts",
      kind: "flipDestroyTrap",
      required: [
        'eventName: "flipSummoned"',
        'effectId).toContain("-1101"',
        'windowKind).toBe("chainResponse")',
        'type === "activateEffect"',
        "duelReason.effect | duelReason.destroy",
        "trap hole flip chain starter resolved",
      ],
    },
  ];
}

export function realScriptLinkedZoneSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: LinkedZoneSpecialSummonKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-parallel-exceed-link-summon-linked-zone.test.ts",
      kind: "handTriggerLinkSummon",
      required: [
        "Group.GetLinkedZone(tp)",
        "Link Summon",
        'type === "activateTrigger"',
        'windowKind: "triggerBucket"',
        'location: "monsterZone"',
        "sequence: 1",
        '"specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-guardragon-elpy-linked-count-zone-summon.test.ts",
      kind: "linkedCountZoneSummon",
      required: [
        "Duel.GetZoneWithLinkedCount(2,tp)",
        "shared linked zone",
        'type === "activateEffect"',
        'location: "monsterZone"',
        "sequence: 1",
        '"specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-knightmare-iblee-to-be-linked-zone-summon.test.ts",
      kind: "toBeLinkedZoneRevive",
      required: [
        "GetToBeLinkedZone",
        "future pointed zone",
        'type === "activateTrigger"',
        'windowKind: "triggerBucket"',
        'location: "monsterZone"',
        "sequence: 1",
        "currentAttack",
        '"specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-summon-sorceress-opponent-linked-zone.test.ts",
      kind: "opponentFieldLinkedZoneSummon",
      required: [
        "GetLinkedZone(1-tp)",
        "opponent field",
        'controller: 1',
        'type === "activateTrigger"',
        'windowKind: "triggerBucket"',
        'location: "monsterZone"',
        "sequence: 0",
        '"specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-altergeist-primebanshee-linked-zone-special-summon.test.ts",
      kind: "releaseCostDeckSummon",
      required: [
        "GetLinkedZone(tp)",
        "release cost",
        'location: "monsterZone"',
        "sequence: 1",
        '"specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
      ],
    },
  ];
}

export function countLinkedZoneSpecialSummonKinds(files: Array<{ kind: LinkedZoneSpecialSummonKind }>): Record<LinkedZoneSpecialSummonKind, number> {
  return files.reduce<Record<LinkedZoneSpecialSummonKind, number>>(
    (counts, { kind }) => {
      counts[kind] += 1;
      return counts;
    },
    {
      handTriggerLinkSummon: 0,
      linkedCountZoneSummon: 0,
      opponentFieldLinkedZoneSummon: 0,
      releaseCostDeckSummon: 0,
      toBeLinkedZoneRevive: 0,
    },
  );
}

export function realScriptSelfTributeZoneSpecialSummonFixtureSnippets(): Array<{ file: string; kind: SelfTributeZoneSpecialSummonKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-beta-electromagnet-search-quick-tribute-summon.test.ts",
      kind: "opponentTurnQuickSelfTributeDeckSummon",
      required: [
        "e3:SetType(EFFECT_TYPE_QUICK_O)",
        "return Duel.IsTurnPlayer(1-tp)",
        "e3:SetCost(Cost.SelfTribute)",
        "if e:GetHandler():GetSequence()<5 then ft=ft+1 end",
        "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
        "duelReason.cost | duelReason.release",
        'eventName: "released"',
        'eventName: "specialSummoned"',
        "effectId: \"lua-3-1002\"",
        "parameter: 0x1",
      ],
    },
    {
      file: "test/lua-real-script-chrysalis-larva-self-tribute-neospace-summon.test.ts",
      kind: "selfTributeFreesMonsterZone",
      required: [
        "Neo Space gated self-tribute cost",
        "sequence: 4",
        "duelReason.release | duelReason.cost",
        'eventName: "released"',
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        "parameter: 0x3",
      ],
    },
    {
      file: "test/lua-real-script-kaibaman-self-tribute-hand-summon.test.ts",
      kind: "selfTributeHandSummonFreesMonsterZone",
      required: [
        "e1:SetCost(Cost.SelfTribute)",
        "if e:GetHandler():GetSequence()<5 then ft=ft+1 end",
        "Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_HAND,0,1,nil,e,tp)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND)",
        "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
        "duelReason.release | duelReason.cost",
        'eventName: "released"',
        'eventName: "specialSummoned"',
        "eventReason: duelReason.summon | duelReason.specialSummon",
        "parameter: 0x2",
        "sequence: 4",
      ],
    },
  ];
}

export function countSelfTributeZoneSpecialSummonKinds(
  files: Array<{ kind: SelfTributeZoneSpecialSummonKind }>,
): Record<SelfTributeZoneSpecialSummonKind, number> {
  return files.reduce<Record<SelfTributeZoneSpecialSummonKind, number>>((counts, { kind }) => {
    counts[kind] += 1;
    return counts;
  }, { opponentTurnQuickSelfTributeDeckSummon: 0, selfTributeFreesMonsterZone: 0, selfTributeHandSummonFreesMonsterZone: 0 });
}

export function realScriptSummonProcedureFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => /^lua-real-script-(?:link|xyz|synchro)-procedure-filters\.test\.ts$/.test(file) || [
      "lua-real-script-chronomaly-moai-special-summon-procedure.test.ts",
      "lua-real-script-caligo-claw-crow-special-summon-procedure.test.ts",
      "lua-real-script-cyber-shark-no-tribute-summon-procedure.test.ts",
      "lua-real-script-cyber-dragon-special-summon-procedure.test.ts",
      "lua-real-script-depth-shark-no-tribute-summon-procedure.test.ts",
      "lua-real-script-desert-twister-special-summon-procedure.test.ts",
      "lua-real-script-emissary-select-tribute-summon-procedure.test.ts",
      "lua-real-script-geira-guile-special-summon-procedure.test.ts",
      "lua-real-script-gimmick-puppet-magnet-doll-special-summon-procedure.test.ts",
      "lua-real-script-gigarays-gandora-special-summon-procedure.test.ts",
      "lua-real-script-great-moth-release-equip-special-summon-procedure.test.ts",
      "lua-real-script-guardian-eatos-special-summon-procedure.test.ts",
      "lua-real-script-leo-wizard-opponent-summon-procedure.test.ts",
      "lua-real-script-malefic-stardust-special-summon-procedure.test.ts",
      "lua-real-script-megarock-dragon-special-summon-procedure.test.ts",
      "lua-real-script-megalith-bethor-ritual-procedure.test.ts",
      "lua-real-script-mitsurugi-mirror-grave-ritual.test.ts",
      "lua-real-script-morganite-field-summon-procedure.test.ts",
      "lua-real-script-palm-ryzeal-special-summon-procedure.test.ts",
      "lua-real-script-pankratops-special-summon-procedure.test.ts",
      "lua-real-script-pendulum-add-procedure-no-scale-activation.test.ts",
      "lua-real-script-flash-knight-pure-pendulum-procedure.test.ts",
      "lua-real-script-pendulum-procedure-actions.test.ts",
      "lua-real-script-polymerization-fusion-summon.test.ts",
      "lua-real-script-prominence-hand-special-summon-procedure.test.ts",
      "lua-real-script-prayers-ritual-matfilter.test.ts",
      "lua-real-script-radiant-typhoon-eldam-special-summon-procedure-search.test.ts",
    ].includes(file))
    .map((file) => path.join("test", file))
    .sort();
}

export function realScriptTypedSummonProcedureFixtureFiles(): string[] {
  return [
    "lua-real-script-link-procedure-filters.test.ts",
    "lua-real-script-megalith-bethor-ritual-procedure.test.ts",
    "lua-real-script-mitsurugi-mirror-grave-ritual.test.ts",
    "lua-real-script-polymerization-fusion-summon.test.ts",
    "lua-real-script-synchro-procedure-filters.test.ts",
    "lua-real-script-xyz-procedure-filters.test.ts",
  ].map((file) => path.join("test", file));
}

export function countSummonProcedureFamilies(files: string[]): Record<SummonProcedureFamily, number> {
  return files.reduce<Record<SummonProcedureFamily, number>>(
    (counts, file) => {
      counts[classifySummonProcedureFamily(file)] += 1;
      return counts;
    },
    {
      fusionProcedure: 0,
      genericSpecialSummonProcedure: 0,
      pendulumProcedure: 0,
      ritualProcedure: 0,
      tributeProcedure: 0,
      typedProcedureFilter: 0,
    },
  );
}

export function classifySummonProcedureFamily(file: string): SummonProcedureFamily {
  const basename = path.basename(file);
  if (/^(lua-real-script-link-procedure-filters|lua-real-script-synchro-procedure-filters|lua-real-script-xyz-procedure-filters)\.test\.ts$/.test(basename)) return "typedProcedureFilter";
  if (basename === "lua-real-script-polymerization-fusion-summon.test.ts") return "fusionProcedure";
  if (/ritual/.test(basename)) return "ritualProcedure";
  if (basename === "lua-real-script-flash-knight-pure-pendulum-procedure.test.ts" || basename === "lua-real-script-pendulum-add-procedure-no-scale-activation.test.ts" || basename === "lua-real-script-pendulum-procedure-actions.test.ts") return "pendulumProcedure";
  if (basename === "lua-real-script-emissary-select-tribute-summon-procedure.test.ts" || basename === "lua-real-script-morganite-field-summon-procedure.test.ts") return "tributeProcedure";
  if (basename.endsWith("-special-summon-procedure.test.ts") || basename === "lua-real-script-radiant-typhoon-eldam-special-summon-procedure-search.test.ts" || basename === "lua-real-script-cyber-shark-no-tribute-summon-procedure.test.ts" || basename === "lua-real-script-depth-shark-no-tribute-summon-procedure.test.ts" || basename === "lua-real-script-leo-wizard-opponent-summon-procedure.test.ts") return "genericSpecialSummonProcedure";
  throw new Error(`Unclassified summon procedure fixture: ${file}`);
}

export function countTypedSummonProcedureKinds(files: string[]): Record<TypedSummonProcedureKind, number> {
  return files.reduce<Record<TypedSummonProcedureKind, number>>(
    (counts, file) => {
      counts[classifyTypedSummonProcedureKind(file)] += 1;
      return counts;
    },
    {
      fusionProcedure: 0,
      linkProcedure: 0,
      ritualProcedure: 0,
      synchroProcedure: 0,
      xyzProcedure: 0,
    },
  );
}

export function classifyTypedSummonProcedureKind(file: string): TypedSummonProcedureKind {
  const basename = path.basename(file);
  if (basename === "lua-real-script-polymerization-fusion-summon.test.ts") return "fusionProcedure";
  if (basename === "lua-real-script-link-procedure-filters.test.ts") return "linkProcedure";
  if (basename === "lua-real-script-megalith-bethor-ritual-procedure.test.ts" || basename === "lua-real-script-mitsurugi-mirror-grave-ritual.test.ts") return "ritualProcedure";
  if (basename === "lua-real-script-synchro-procedure-filters.test.ts") return "synchroProcedure";
  if (basename === "lua-real-script-xyz-procedure-filters.test.ts") return "xyzProcedure";
  throw new Error(`Unclassified typed summon procedure fixture: ${file}`);
}

export function realScriptPendulumGrantFixtureFiles(): string[] {
  return [
    "lua-real-script-extra-pendulum-location-grant.test.ts",
    "lua-real-script-extra-pendulum-opponent-scale-grant.test.ts",
    "lua-real-script-harmonic-oscillation-pendulum-grant.test.ts",
    "lua-real-script-soul-pendulum-extra-summon.test.ts",
  ].map((file) => path.join("test", file));
}

export function countPendulumGrantKinds(files: string[]): Record<PendulumGrantKind, number> {
  return files.reduce<Record<PendulumGrantKind, number>>(
    (counts, file) => {
      counts[classifyPendulumGrantKind(file)] += 1;
      return counts;
    },
    {
      extraDeckLocationGrant: 0,
      extraSummonCountGrant: 0,
      opponentScaleGrant: 0,
      opponentScaleSelectionGrant: 0,
    },
  );
}

export function classifyPendulumGrantKind(file: string): PendulumGrantKind {
  const basename = path.basename(file);
  if (basename === "lua-real-script-extra-pendulum-location-grant.test.ts") return "extraDeckLocationGrant";
  if (basename === "lua-real-script-extra-pendulum-opponent-scale-grant.test.ts") return "opponentScaleSelectionGrant";
  if (basename === "lua-real-script-harmonic-oscillation-pendulum-grant.test.ts") return "opponentScaleGrant";
  if (basename === "lua-real-script-soul-pendulum-extra-summon.test.ts") return "extraSummonCountGrant";
  throw new Error(`Unclassified Pendulum grant fixture: ${file}`);
}

export function realScriptPendulumHelperFixtureSnippets(): Array<{ file: string; kind: PendulumHelperKind; required: string[] }> {
  return ([
    {
      file: "lua-real-script-abyss-actor-twinkle-pendulum-setcode-lock.test.ts",
      kind: "pendulumSummonLock",
      required: [
        `luaTargetDescriptor: \`target:pendulum-summon-not-setcode:\${setAbyssActor}\``,
        "twinkle abyss actor pendulum special 1",
        "twinkle generic pendulum special 0",
        "twinkle regular special 1",
        "getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)",
      ],
    },
    {
      file: "lua-real-script-couplet-pendulum-light-lock.test.ts",
      kind: "pendulumSummonLock",
      required: [
        `luaTargetDescriptor: \`target:pendulum-summon-not-attribute:\${attributeLight}\``,
        "couplet light pendulum special 1",
        "couplet dark pendulum special 0",
        "couplet dark regular special 1",
        "getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)",
      ],
    },
    {
      file: "lua-real-script-odd-eyes-phantasma-pendulum-summon-lock.test.ts",
      kind: "pendulumSummonLock",
      required: [
        `luaTargetDescriptor: \`target:special-summon-type-is:\${luaSummonTypePendulum}\``,
        "phantasma pendulum special 0",
        "phantasma regular special 1",
        "getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)",
      ],
    },
    {
      file: "lua-real-script-pendulum-procedure-actions.test.ts",
      kind: "procedureAction",
      required: [
        "findPendulumActivation",
        "const restoredPendulumWindow = restoreDuelWithLuaScripts",
        "const pendulumSummon = getLuaRestoreLegalActions(restoredPendulumWindow, 0).find",
        'summonType: "pendulum"',
        "expect(restoredPendulumWindow.session.state.players[0].pendulumSummonAvailable).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-flash-knight-pure-pendulum-procedure.test.ts",
      kind: "procedureAction",
      required: [
        'const flashKnightCode = "17390179"',
        'const mandragonCode = "19474136"',
        'const fireOpalHeadCode = "28363749"',
        "pendulumProcedureEffects(restoredLowScaleWindow.session, mandragon!.uid)",
        "findPendulumScaleActivation(restoredLowScaleWindow.session, getLuaRestoreLegalActions(restoredLowScaleWindow, 0), mandragon!.uid)",
        'label: "Pendulum Summon Fire Opal Head"',
        'summonType: "pendulum"',
        "expect(restoredPendulumWindow.session.state.players[0].pendulumSummonAvailable).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-pendulum-add-procedure-no-scale-activation.test.ts",
      kind: "procedureNoScaleActivation",
      required: [
        "Pendulum AddProcedure reg=false",
        "findPendulumScaleActivation",
        "effect.description === 1160",
        "description: 1163",
        "code: effectSummonProcedureGroup",
        'summonType: "pendulum"',
        "expect(restoredPendulumWindow.session.state.players[0].pendulumSummonAvailable).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-pendulum-evolution-direct-pendulum-summon.test.ts",
      kind: "directPendulumSummon",
      required: [
        "Duel.PendulumSummon(tp)",
        "findPendulumEvolutionSummon",
        'eventName: "specialSummoned"',
        'summonType: "pendulum"',
        "expect(restored.session.state.players[0].pendulumSummonAvailable).toBe(false)",
        "registerDuelFlagEffect",
      ],
    },
    {
      file: "lua-real-script-soul-pendulum-extra-summon.test.ts",
      kind: "extraSummonCountGrant",
      required: [
        "session.state.players[0].pendulumSummonAvailable = false",
        "expect(findPendulumSummon(restored.session, getLuaRestoreLegalActions(restored, 0), candidate!.uid)).toBeUndefined()",
        "applyLuaRestoreAndAssert(restoredAfterGrant, { ...pendulumSummon!, summonUids: [candidate!.uid] })",
        'summonType: "pendulum"',
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-extra-pendulum-location-grant.test.ts",
      kind: "extraDeckGrant",
      required: [
        "expect(findPendulumSummon(getLuaRestoreLegalActions(restored, 0), extraCandidate!.uid)).toBeUndefined()",
        "expect(restoredAfterGrant.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerType: \"player\", ownerId: \"0\", code: Number(extraPendulumCode) })]))",
        "expect(findExtraPendulumActivation(restoredAfterGrant.session, getLuaRestoreLegalActions(restoredAfterGrant, 0), secondExtraPendulum!.uid)).toBeUndefined()",
        "expect(pendulumSummon!.summonUids).not.toContain(handCandidate!.uid)",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-extra-pendulum-opponent-scale-grant.test.ts",
      kind: "extraDeckGrant",
      required: [
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([",
        "expect.objectContaining({ locationMask: 0x40, scaleAlternatives: [expect.objectContaining({ locationMask: 0x40, scalePlayer: 1 })] })",
        "expect(pendulumSummon!.summonUids).not.toContain(handCandidate!.uid)",
        'summonType: "pendulum"',
      ],
    },
    {
      file: "lua-real-script-harmonic-oscillation-pendulum-grant.test.ts",
      kind: "extraDeckGrant",
      required: [
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ locationMask: 0x40, scalePlayer: 1 })])",
        "expect(pendulumSummon!.summonUids).toContain(extraCandidate!.uid)",
        "expect(pendulumSummon!.summonUids).not.toContain(handCandidate!.uid)",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-zefraath-special-summon-pendulum-grant.test.ts",
      kind: "filteredSetcodeGrant",
      required: [
        "expect(session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ setcode: setZefra })])",
        "expect(restored.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerType: \"player\", ownerId: \"0\", code: Number(zefraathCode) })]))",
        "expect(pendulumSummon!.summonUids).not.toContain(rejectedCandidate!.uid)",
        "expect(restored.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-moissa-knight-hand-pendulum-grant.test.ts",
      kind: "handGrant",
      required: [
        "expect(pendulumSummon!.summonUids).toContain(handCandidate!.uid)",
        "expect(pendulumSummon!.summonUids).not.toContain(extraCandidate!.uid)",
        "applyLuaRestoreAndAssert(restoredAfterGrant, { ...pendulumSummon!, summonUids: [handCandidate!.uid] })",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-ddd-zeus-ragnarok-filtered-pendulum-grant.test.ts",
      kind: "filteredSetcodeGrant",
      required: [
        "expect(restoredAfterGrant.session.state.flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerType: \"player\", ownerId: \"0\", code: Number(zeusCode) })]))",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ setcode: setDD })])",
        "expect(pendulumSummon!.summonUids).not.toContain(rejectedCandidate!.uid)",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-solfachord-happiness-filtered-pendulum-grant.test.ts",
      kind: "filteredSetcodeGrant",
      required: [
        "expect(findPendulumSummon(getLuaRestoreLegalActions(restored, 0), allowedCandidate!.uid)).toBeUndefined()",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummonGrants).toEqual([expect.objectContaining({ setcode: setSolfachord })])",
        "expect(pendulumSummon!.summonUids).not.toContain(rejectedCandidate!.uid)",
        "expect(restoredAfterGrant.session.state.players[0].extraPendulumSummons).toBe(0)",
      ],
    },
    {
      file: "lua-real-script-blue-eyes-spirit-pendulum-count-limit.test.ts",
      kind: "extraSummonCountGrant",
      required: [
        "expect.objectContaining({ maxSummons: 4, summonUids: [first.uid, second.uid] })",
        "expect.objectContaining({ maxSummons: 1, summonUids: [first.uid, second.uid] })",
        "expect(applyResponse(session, { ...restrictedAction, summonUids: [first.uid, second.uid] }).ok).toBe(false)",
        'Debug.Message("spirit pendulum can " .. tostring(Duel.IsPlayerCanPendulumSummon(0)))',
        'Debug.Message("spirit pendulum summoned " .. Duel.PendulumSummon(0))',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PendulumHelperKind;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

export function countPendulumHelperKinds(
  fixtures: Array<{ kind: PendulumHelperKind }>,
): Record<PendulumHelperKind, number> {
  return fixtures.reduce<Record<PendulumHelperKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      directPendulumSummon: 0,
      extraDeckGrant: 0,
      extraSummonCountGrant: 0,
      filteredSetcodeGrant: 0,
      handGrant: 0,
      pendulumSummonLock: 0,
      procedureAction: 0,
      procedureNoScaleActivation: 0,
    },
  );
}

export function realScriptUnionProcedureFixtureSnippets(): Array<{
  file: string;
  kind: SummonUnionProcedureKind;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "equipAndSummonBack",
      required: [
        "getLuaRestoreLegalActionGroups(restoredEquipWindow, 0).flatMap((group) => group.actions)",
        "findEffectAction(restoredEquipWindow.session, getLuaRestoreLegalActions(restoredEquipWindow, 0), unionDriver!.uid, 1068)",
        'location: "spellTrapZone", equippedToUid: target!.uid',
        "findEffectAction(restoredSummonWindow.session, getLuaRestoreLegalActions(restoredSummonWindow, 0), unionDriver!.uid, 2)",
        'location: "monsterZone"',
        "previousEquippedToUid: target!.uid",
      ],
    },
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "deckEquipBanish",
      required: [
        "const platformCode = \"23265594\"",
        "findEffectActionByCategory(restoredDriverDeckEquipWindow.session, getLuaRestoreLegalActions(restoredDriverDeckEquipWindow, 0), unionDriver!.uid, 0x40000)",
        'location: "banished", previousEquippedToUid: target!.uid',
        'location: "spellTrapZone", equippedToUid: target!.uid',
        "effect.sourceUid === platform!.uid && (effect.code === 76 || effect.code === 347)",
      ],
    },
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "equippedRitualSummon",
      required: [
        "const unionPilotCode = \"89357740\"",
        "findEffectActionByCategory(restoredEquippedState.session, getLuaRestoreLegalActions(restoredEquippedState, 0), unionPilot!.uid, 0x40200)",
        "previousEquippedToUid: target!.uid",
        '{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }',
        'eventName: "specialSummoned", eventCode: 1102',
      ],
    },
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "battleTriggerSummonBack",
      required: [
        "const trigonCode = \"48568432\"",
        "findEffectAction(restoredEquipWindow.session, getLuaRestoreLegalActions(restoredEquipWindow, 0), trigon!.uid, 1068)",
        'location: "spellTrapZone"',
        "equippedToUid: target!.uid",
        "passRestoredBattleResponsesUntilTrigger(restoredBattleWindow)",
        'eventName: "battleDestroyed"',
        "const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === \"activateTrigger\" && action.uid === trigon!.uid)",
        "expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === graveMachine!.uid)).toMatchObject",
        'summonType: "special"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonUnionProcedureKind;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

export function realScriptMaterialLockFixtureSnippets(): Array<{
  file: string;
  kind: SummonMaterialLockKind;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-mysterion-fusion-material-lock.test.ts",
      kind: "fusionMaterialLock",
      required: [
        "code: 235",
        'action.type === "fusionSummon"',
        "cannot be used as fusion material",
      ],
    },
    {
      file: "lua-real-script-doggy-diver-xyz-material-lock.test.ts",
      kind: "xyzMaterialLock",
      required: [
        "code: 238",
        'action.type === "xyzSummon"',
        "cannot be used as Xyz material",
      ],
    },
    {
      file: "lua-real-script-anger-knuckle-link-material-lock.test.ts",
      kind: "linkMaterialLock",
      required: [
        "code: 239",
        'action.type === "linkSummon"',
        "cannot be used as Link material",
      ],
    },
    {
      file: "lua-real-script-fallin-cheatah-generic-material-lock.test.ts",
      kind: "genericMaterialLock",
      required: [
        "code: 248",
        'action.type === "fusionSummon"',
        'action.type === "synchroSummon"',
        'action.type === "xyzSummon"',
        'action.type === "linkSummon"',
        "ritualSummonDuelCard",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonMaterialLockKind;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

export function countSummonUnionProcedureKinds(
  fixtures: Array<{ kind: SummonUnionProcedureKind }>,
): Record<SummonUnionProcedureKind, number> {
  return fixtures.reduce<Record<SummonUnionProcedureKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      battleTriggerSummonBack: 0,
      deckEquipBanish: 0,
      equipAndSummonBack: 0,
      equippedRitualSummon: 0,
    },
  );
}

export function countSummonMaterialLockKinds(
  fixtures: Array<{ kind: SummonMaterialLockKind }>,
): Record<SummonMaterialLockKind, number> {
  return fixtures.reduce<Record<SummonMaterialLockKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      fusionMaterialLock: 0,
      genericMaterialLock: 0,
      linkMaterialLock: 0,
      xyzMaterialLock: 0,
    },
  );
}

export function countFlipSummonSuccessTrapKinds(
  fixtures: Array<{ kind: FlipSummonSuccessTrapKind }>,
): Record<FlipSummonSuccessTrapKind, number> {
  return fixtures.reduce<Record<FlipSummonSuccessTrapKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      flipBanishTrap: 0,
      flipDestroyTrap: 0,
      flipStatTrap: 0,
    },
  );
}

export function summonSemanticVariants(): Array<{ file: string; kind: SummonSemanticVariant }> {
  return [
    ...realScriptSummonFixtureFiles().map((file) => ({ file, kind: "realScriptSummonKeywordCorpus" as const })),
    ...realScriptSummonProcedureFixtureFiles().map((file) => ({ file, kind: "summonProcedureLegalWindows" as const })),
    ...realScriptTypedSummonProcedureFixtureFiles().map((file) => ({ file, kind: "typedSummonProcedurePlacement" as const })),
    ...realScriptPendulumGrantFixtureFiles().map((file) => ({ file, kind: "pendulumGrantConsumption" as const })),
    ...realScriptPendulumHelperFixtureSnippets().map(({ file }) => ({ file, kind: "pendulumHelperGrantFilters" as const })),
    ...realScriptUnionProcedureFixtureSnippets().map(({ file }) => ({ file, kind: "unionEquipAndSummonBackProcedures" as const })),
    ...realScriptMaterialLockFixtureSnippets().map(({ file }) => ({ file, kind: "summonMaterialLockSuppression" as const })),
    ...realScriptFlipSummonSuccessTrapFixtureSnippets().map(({ file }) => ({ file, kind: "flipSummonSuccessTrapResponses" as const })),
    ...realScriptLinkedZoneSpecialSummonFixtureSnippets().map(({ file }) => ({ file, kind: "linkedZoneSpecialSummons" as const })),
    ...realScriptSelfTributeZoneSpecialSummonFixtureSnippets().map(({ file }) => ({ file, kind: "selfTributeZoneSpecialSummons" as const })),
    ...realScriptReleaseCostSpecialSummonFixtureSnippets().map(({ file }) => ({ file, kind: "releaseCostSpecialSummons" as const })),
    ...realScriptFreeChainSpecialSummonFixtureSnippets().map(({ file }) => ({ file, kind: "freeChainSpecialSummons" as const })),
    ...realScriptIgnitionCostSpecialSummonFixtureSnippets().map(({ file }) => ({ file, kind: "ignitionCostSpecialSummons" as const })),
    ...realScriptDiscardTriggerSpecialSummonFixtureSnippets().map(({ file }) => ({ file, kind: "discardTriggerSpecialSummons" as const })),
    ...realScriptSummonSuccessTargetSpecialSummonFixtureSnippets().map(({ file }) => ({ file, kind: "summonSuccessTargetSpecialSummons" as const })),
    ...realScriptSummonSuccessSelfSpecialSummonFixtureSnippets().map(({ file }) => ({ file, kind: "summonSuccessSelfSpecialSummons" as const })),
    { file: "test/lua-real-script-kaiser-sea-horse-double-tribute-summon.test.ts", kind: "tributeMaterialValuePredicates" as const },
    { file: "test/lua-real-script-rare-metal-dragon-unsummonable.test.ts", kind: "unsummonableSummonSetLocks" as const },
    ...realScriptForceMonsterZoneSummonLockFixtureSnippets().map(({ file }) => ({ file, kind: "forceMonsterZoneSummonLocks" as const })),
  ];
}

export function countSummonSemanticVariants(
  fixtures: Array<{ kind: SummonSemanticVariant }>,
): Record<SummonSemanticVariant, number> {
  return fixtures.reduce<Record<SummonSemanticVariant, number>>(
    (counts, { kind }) => {
      counts[kind] += 1;
      return counts;
    },
    {
      realScriptSummonKeywordCorpus: 0,
      summonProcedureLegalWindows: 0,
      typedSummonProcedurePlacement: 0,
      pendulumGrantConsumption: 0,
      pendulumHelperGrantFilters: 0,
      unionEquipAndSummonBackProcedures: 0,
      summonMaterialLockSuppression: 0,
      flipSummonSuccessTrapResponses: 0,
      linkedZoneSpecialSummons: 0,
      selfTributeZoneSpecialSummons: 0,
      releaseCostSpecialSummons: 0,
      freeChainSpecialSummons: 0,
      ignitionCostSpecialSummons: 0,
      discardTriggerSpecialSummons: 0,
      summonSuccessTargetSpecialSummons: 0,
      summonSuccessSelfSpecialSummons: 0,
      tributeMaterialValuePredicates: 0,
      unsummonableSummonSetLocks: 0,
      forceMonsterZoneSummonLocks: 0,
    },
  );
}

export function groupSummonSemanticVariantFiles(
  fixtures: Array<{ file: string; kind: SummonSemanticVariant }>,
): Record<SummonSemanticVariant, string[]> {
  return fixtures.reduce<Record<SummonSemanticVariant, string[]>>(
    (groups, { file, kind }) => {
      groups[kind].push(file);
      return groups;
    },
    {
      realScriptSummonKeywordCorpus: [],
      summonProcedureLegalWindows: [],
      typedSummonProcedurePlacement: [],
      pendulumGrantConsumption: [],
      pendulumHelperGrantFilters: [],
      unionEquipAndSummonBackProcedures: [],
      summonMaterialLockSuppression: [],
      flipSummonSuccessTrapResponses: [],
      linkedZoneSpecialSummons: [],
      selfTributeZoneSpecialSummons: [],
      releaseCostSpecialSummons: [],
      freeChainSpecialSummons: [],
      ignitionCostSpecialSummons: [],
      discardTriggerSpecialSummons: [],
      summonSuccessTargetSpecialSummons: [],
      summonSuccessSelfSpecialSummons: [],
      tributeMaterialValuePredicates: [],
      unsummonableSummonSetLocks: [],
      forceMonsterZoneSummonLocks: [],
    },
  );
}
