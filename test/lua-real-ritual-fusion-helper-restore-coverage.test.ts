import fs from "node:fs"; import path from "node:path";
import { describe, expect, it } from "vitest"; import { coverageText, hasCoverageSnippet } from "./coverage-text.js";
const root = process.cwd(), representativeRitualFusionHelperFamilyCounts: Record<RitualFusionHelperFamily, number> = { fusion: 32, ritual: 17 };
const representativeRitualFusionHelperKindCounts: Record<RitualFusionHelperKind, number> = {
  contactFusionBanish: 1, contactFusionCustomSummonType: 1,
  contactFusionOpponentMaterial: 1, contactFusionSendCost: 1,
  customRitualOperation: 1,
  fusionAddProcCode2ExactCodeMetadata: 1,
  fusionAddProcCodeRepRepeatedCodeMetadata: 1,
  fusionAddProcFunRepSetcodeMetadata: 1,
  fusionAddProcMixMaterialMetadata: 1,
  fusionAddProcMixAttackBelowPredicateMetadata: 1, fusionAddProcMixAttackPredicateMetadata: 1, fusionAddProcMixNMixedMetadata: 1, fusionAddProcMixNRepeatedAttackBelowMetadata: 1, fusionAddProcMixNRepeatedCodeMetadata: 1, fusionAddProcMixNRepeatedPlusTypeMetadata: 1, fusionAddProcMixNSetcodeMetadata: 1, fusionAddProcMixPlusTypePredicateMetadata: 1, fusionAddProcMixPredicateMetadata: 1,
  fusionAddProcMixRepExactCodeMetadata: 1, fusionAddProcMixRepLocationMetadata: 1, fusionAddProcMixRepRequiredSetcodeMetadata: 1, fusionAddProcMixRepSetcodeMetadata: 1,
  fusionDeckMaterialOath: 1,
  fusionForcedHandler: 1,
  fusionFcheck: 1,
  fusionGraveBanishMaterial: 1,
  fusionHandMaterial: 1,
  fusionMaterialCheck: 1,
  fusionOpponentExtrafil: 1,
  fusionPartialExtraop: 1,
  fusionShuffleMaterial: 1,
  fusionStage2Oath: 1,
  fusionStage2Protection: 1,
  ritualDeckExtraop: 1,
  ritualDeckTargetLocation: 1,
  ritualEqualLevel: 1,
  ritualExtraDeckMaterial: 1,
  ritualExtraMaterialNormalDeck: 1,
  ritualGraveBanishMaterial: 1,
  ritualGreaterCode: 1,
  ritualGraveExtraMaterial: 1,
  ritualMaterialFilter: 1,
  ritualOpponentFieldMaterial: 1,
  ritualOperationReassigned: 1,
  ritualSelectOptionSumpos: 1,
  ritualSelfProcedure: 1,
  ritualSpecificMaterial: 1,
  ritualStage2: 2,
};
const ritualFusionHelperSemanticVariantCounts: Record<RitualFusionHelperSemanticVariant, number> = {
  blueEyesUltimateAddProcCodeRep: 1,
  blackSkullDragonAddProcMix: 1,
  cyberEndDragonAddProcMixN: 1,
  doubleSubstituteSuppression: 1,
  dynaForcedHandler: 1,
  dynaForcedHandlerSuppression: 1,
  earthChantEqualLevel: 1,
  fallenAlbazNoTrigger: 1,
  fallenAlbazOpponentMaterial: 1,
  goddessFusionSubstitute: 1,
  heavyExtraMaterialCountSuppression: 1,
  heavyPartialExtraop: 1,
  luminousEqualCode: 1,
  luaPredicateFusionSubstitute: 1,
  meteonisRequirementFunc: 1,
  polymerizationHandMaterials: 1,
  primiteFcheck: 1,
  primiteFcheckSuppression: 1,
  secretsDarkMagicMatcheck: 1,
  secretsDarkMagicSuppression: 1,
  secretsForcedSelection: 1,
};

describe("Lua real Ritual and Fusion helper restore coverage", () => {
  it("keeps the representative Ritual/Fusion helper fixture inventory broad", () => {
    expect(representativeRitualFusionHelperFixtures()).toHaveLength(49);
  });

  it("keeps representative Ritual/Fusion helper fixture families balanced", () => {
    expect(countFixtureFamilies(representativeRitualFusionHelperFixtures())).toEqual(representativeRitualFusionHelperFamilyCounts);
  });

  it("keeps representative Ritual/Fusion helper fixture kinds explicit", () => {
    expect(countFixtureKinds(representativeRitualFusionHelperFixtures())).toEqual(representativeRitualFusionHelperKindCounts);
  });

  it("keeps multi-branch Ritual/Fusion helper semantic variants explicit", () => {
    expect(countSemanticVariants(ritualFusionHelperSemanticVariants())).toEqual(ritualFusionHelperSemanticVariantCounts);

    const weak = ritualFusionHelperSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("requires representative Ritual/Fusion helper fixtures to assert clean Lua restore", () => {
    const missing = representativeRitualFusionHelperFixtures()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires representative Ritual/Fusion helper fixtures to prove restored helper semantics", () => {
    const weak = representativeRitualFusionHelperFixtures()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(weak).toEqual([]);
  });
});

type RitualFusionHelperFamily = "fusion" | "ritual";
type RitualFusionHelperKind = "contactFusionBanish" | "contactFusionCustomSummonType" | "contactFusionOpponentMaterial" | "contactFusionSendCost" | "customRitualOperation"
  | "fusionAddProcCode2ExactCodeMetadata"
  | "fusionAddProcCodeRepRepeatedCodeMetadata"
  | "fusionAddProcFunRepSetcodeMetadata"
  | "fusionAddProcMixMaterialMetadata" | "fusionAddProcMixAttackBelowPredicateMetadata" | "fusionAddProcMixAttackPredicateMetadata"
  | "fusionAddProcMixNMixedMetadata" | "fusionAddProcMixNRepeatedAttackBelowMetadata" | "fusionAddProcMixNRepeatedCodeMetadata" | "fusionAddProcMixNRepeatedPlusTypeMetadata" | "fusionAddProcMixNSetcodeMetadata" | "fusionAddProcMixPlusTypePredicateMetadata" | "fusionAddProcMixPredicateMetadata"
  | "fusionAddProcMixRepExactCodeMetadata" | "fusionAddProcMixRepLocationMetadata" | "fusionAddProcMixRepRequiredSetcodeMetadata" | "fusionAddProcMixRepSetcodeMetadata"
  | "fusionDeckMaterialOath"
  | "fusionForcedHandler"
  | "fusionFcheck"
  | "fusionGraveBanishMaterial"
  | "fusionHandMaterial"
  | "fusionMaterialCheck"
  | "fusionOpponentExtrafil"
  | "fusionPartialExtraop"
  | "fusionShuffleMaterial"
  | "fusionStage2Oath"
  | "fusionStage2Protection"
  | "ritualDeckExtraop"
  | "ritualDeckTargetLocation"
  | "ritualEqualLevel"
  | "ritualExtraDeckMaterial"
  | "ritualExtraMaterialNormalDeck"
  | "ritualGraveBanishMaterial"
  | "ritualGreaterCode"
  | "ritualGraveExtraMaterial"
  | "ritualMaterialFilter"
  | "ritualOpponentFieldMaterial"
  | "ritualOperationReassigned"
  | "ritualSelectOptionSumpos"
  | "ritualSelfProcedure"
  | "ritualSpecificMaterial"
  | "ritualStage2";
type RitualFusionHelperSemanticVariant =
  | "blueEyesUltimateAddProcCodeRep"
  | "blackSkullDragonAddProcMix"
  | "cyberEndDragonAddProcMixN"
  | "doubleSubstituteSuppression"
  | "dynaForcedHandler"
  | "dynaForcedHandlerSuppression"
  | "earthChantEqualLevel"
  | "fallenAlbazNoTrigger"
  | "fallenAlbazOpponentMaterial"
  | "goddessFusionSubstitute"
  | "heavyExtraMaterialCountSuppression"
  | "heavyPartialExtraop"
  | "luminousEqualCode"
  | "luaPredicateFusionSubstitute"
  | "meteonisRequirementFunc"
  | "polymerizationHandMaterials"
  | "primiteFcheck"
  | "primiteFcheckSuppression"
  | "secretsDarkMagicMatcheck"
  | "secretsDarkMagicSuppression"
  | "secretsForcedSelection";

function countFixtureFamilies(fixtures: Array<{ families: RitualFusionHelperFamily[] }>): Record<RitualFusionHelperFamily, number> {
  return fixtures
    .flatMap(({ families }) => families)
    .reduce<Record<RitualFusionHelperFamily, number>>(
      (counts, family) => ({ ...counts, [family]: counts[family] + 1 }),
      { fusion: 0, ritual: 0 },
    );
}

function countFixtureKinds(fixtures: Array<{ kind: RitualFusionHelperKind }>): Record<RitualFusionHelperKind, number> {
  return fixtures.reduce(
    (counts, { kind }) => {
      counts[kind] += 1;
      return counts;
    },
    Object.fromEntries(Object.keys(representativeRitualFusionHelperKindCounts).map((kind) => [kind, 0])) as Record<RitualFusionHelperKind, number>,
  );
}

function countSemanticVariants(fixtures: Array<{ kind: RitualFusionHelperSemanticVariant }>): Record<RitualFusionHelperSemanticVariant, number> {
  return fixtures.reduce(
    (counts, { kind }) => {
      counts[kind] += 1;
      return counts;
    },
    Object.fromEntries(Object.keys(ritualFusionHelperSemanticVariantCounts).map((kind) => [kind, 0])) as Record<RitualFusionHelperSemanticVariant, number>,
  );
}

function ritualFusionHelperSemanticVariants(): Array<{ file: string; kind: RitualFusionHelperSemanticVariant; required: string[] }> {
  return ([
    {
      file: "test/lua-real-script-blue-eyes-ultimate-addproccoderep-fusion.test.ts",
      kind: "blueEyesUltimateAddProcCodeRep",
      required: [
        "restores repeated Fusion.AddProcCodeRep material metadata and lets Polymerization summon Blue-Eyes Ultimate Dragon",
        "const blueEyesUltimateCode = \"511006007\"",
        "expect(blueEyesUltimate!.data.fusionMaterials).toEqual([blueEyesCode, blueEyesCode, blueEyesCode])",
        "summonMaterialUids: blueEyesMaterials.map((card) => card.uid)",
      ],
    },
    {
      file: "test/lua-real-script-black-skull-dragon-addprocmix-fusion.test.ts",
      kind: "blackSkullDragonAddProcMix",
      required: [
        "restores Fusion.AddProcMix material metadata and lets Polymerization summon Black Skull Dragon",
        "const blackSkullCode = \"11901678\"",
        "expect(blackSkull!.data.fusionMaterials).toEqual([summonedSkullCode, redEyesCode])",
        "summonMaterialUids: [summonedSkull!.uid, redEyes!.uid]",
      ],
    },
    {
      file: "test/lua-real-script-cyber-end-dragon-addprocmixn-fusion.test.ts",
      kind: "cyberEndDragonAddProcMixN",
      required: [
        "restores exact repeated Fusion.AddProcMixN material metadata and lets Polymerization summon Cyber End Dragon",
        "const cyberEndCode = \"1546123\"",
        "expect(cyberEnd!.data.fusionMaterials).toEqual([cyberDragonCode, cyberDragonCode, cyberDragonCode])",
        "summonMaterialUids: cyberDragons.map((card) => card.uid)",
      ],
    },
    {
      file: "test/lua-real-script-polymerization-fusion-summon.test.ts",
      kind: "doubleSubstituteSuppression",
      required: [
        "does not allow two Fusion substitutes to replace both listed materials",
        "const goddessCode = \"53493204\"",
        "expect(getLegalActions(session, 0).some((action) => action.type === \"activateEffect\" && action.uid === polymerization!.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-dyna-base-forced-handler-fusion.test.ts",
      kind: "dynaForcedHandler",
      required: [
        "restores a Fusion Summon that must use the activating handler as material",
        "const dynaBaseCode = \"39396763\"",
        "summonMaterialUids: [dynaBase!.uid, material!.uid]",
      ],
    },
    {
      file: "test/lua-real-script-dyna-base-forced-handler-fusion.test.ts",
      kind: "dynaForcedHandlerSuppression",
      required: [
        "does not expose the Fusion action when the target cannot use Dyna Base",
        "const materialACode = \"39396768\"",
        "getLegalActions(session, 0).find((action) => action.type === \"activateEffect\" && action.uid === dynaBase!.uid)).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-earth-chant-ritual-equal.test.ts",
      kind: "earthChantEqualLevel",
      required: [
        "restores AddProcEqual and selects exact-level Ritual materials",
        "const earthChantCode = \"59820352\"",
        "summonMaterialUids: [materialA!.uid, materialC!.uid]",
      ],
    },
    {
      file: "test/lua-real-script-fallen-of-albaz-opponent-fusion.test.ts",
      kind: "fallenAlbazNoTrigger",
      required: [
        "does not expose the summon-success trigger when the Fusion target cannot use Albaz",
        "const ownMaterialCode = \"68468464\"",
        "cannot use Albaz",
      ],
    },
    {
      file: "test/lua-real-script-fallen-of-albaz-opponent-fusion.test.ts",
      kind: "fallenAlbazOpponentMaterial",
      required: [
        "restores a Fusion Summon using Albaz and an opponent monster as material",
        "const albazCode = \"68468459\"",
        "summonMaterialUids: [albaz!.uid, opponentMaterial!.uid]",
      ],
    },
    {
      file: "test/lua-real-script-polymerization-fusion-summon.test.ts",
      kind: "goddessFusionSubstitute",
      required: [
        "uses a real Fusion substitute monster for one specifically listed material",
        "const goddessCode = \"53493204\"",
        "summonMaterialUids: [goddess!.uid, materialB!.uid]",
      ],
    },
    {
      file: "test/lua-real-script-heavy-polymerization-partial-extraop.test.ts",
      kind: "heavyExtraMaterialCountSuppression",
      required: [
        "does not expose Heavy Polymerization when the Extra Deck material count exceeds the opponent's monsters",
        "const heavyPolymerizationCode = \"58570206\"",
        "count exceeds the opponent's monsters",
      ],
    },
    {
      file: "test/lua-real-script-heavy-polymerization-partial-extraop.test.ts",
      kind: "heavyPartialExtraop",
      required: [
        "restores Extra Deck material fcheck, banishes only Extra Deck materials, then sends remaining Fusion materials to the Graveyard",
        "const heavyPolymerizationCode = \"58570206\"",
        "expect(chainLink.possibleOperationInfos).toEqual([{ category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
      ],
    },
    {
      file: "test/lua-real-script-earth-chant-ritual-equal.test.ts",
      kind: "luminousEqualCode",
      required: [
        "restores AddProcEqualCode into an exact-code Ritual Summon",
        "const luminousDragonRitualCode = \"34834619\"",
        "summonMaterialUids: [exactMaterial!.uid]",
      ],
    },
    {
      file: "test/lua-real-script-polymerization-fusion-summon.test.ts",
      kind: "luaPredicateFusionSubstitute",
      required: [
        "honors Lua Fusion substitute value predicates against the Fusion target",
        "const substituteCode = \"2440\"",
        "summonMaterialUids: [substitute!.uid, materialB!.uid]",
      ],
    },
    {
      file: "test/lua-real-script-earth-chant-ritual-equal.test.ts",
      kind: "meteonisRequirementFunc",
      required: [
        "restores Ritual requirementfunc material value callbacks",
        "const meteonisCode = \"22398665\"",
        "summonMaterialUids: [validMaterial!.uid]",
      ],
    },
    {
      file: "test/lua-real-script-polymerization-fusion-summon.test.ts",
      kind: "polymerizationHandMaterials",
      required: [
        "restores Polymerization's registered Fusion Summon effect and resolves selected hand materials",
        "const polymerizationCode = \"24094653\"",
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
      ],
    },
    {
      file: "test/lua-real-script-primite-fusion-extra-check.test.ts",
      kind: "primiteFcheck",
      required: [
        "restores extra material fcheck and shuffles a Normal Monster material into the Deck",
        "const primiteFusionCode = \"99161253\"",
        "summonMaterialUids: [normalMaterial!.uid, effectMaterial!.uid]",
      ],
    },
    {
      file: "test/lua-real-script-primite-fusion-extra-check.test.ts",
      kind: "primiteFcheckSuppression",
      required: [
        "does not expose Primite Fusion when the selected material set has no Normal Monster",
        "const materialACode = \"9920\"",
        "no Normal Monster",
      ],
    },
    {
      file: "test/lua-real-script-secrets-dark-magic-fusion-matcheck.test.ts",
      kind: "secretsDarkMagicMatcheck",
      required: [
        "restores the Fusion material check that requires Dark Magician or Dark Magician Girl",
        "const secretsCode = \"59514116\"",
        "summonMaterialUids: [darkMagician!.uid, material!.uid]",
      ],
    },
    {
      file: "test/lua-real-script-secrets-dark-magic-fusion-matcheck.test.ts",
      kind: "secretsDarkMagicSuppression",
      required: [
        "does not expose the Fusion activation when no selected material is Dark Magician or Dark Magician Girl",
        "const materialACode = \"59514120\"",
        "no selected material is Dark Magician or Dark Magician Girl",
      ],
    },
    {
      file: "test/lua-real-script-earth-chant-ritual-equal.test.ts",
      kind: "secretsForcedSelection",
      required: [
        "restores Ritual forcedselection material requirements",
        "const secretsCode = \"59514116\"",
        "summonMaterialUids: [darkMagician!.uid]",
      ],
    },
  ] satisfies Array<{ file: string; kind: RitualFusionHelperSemanticVariant; required: string[] }>).sort((a, b) => a.kind.localeCompare(b.kind));
}

function representativeRitualFusionHelperFixtures(): Array<{ file: string; kind: RitualFusionHelperKind; families: RitualFusionHelperFamily[]; required: string[] }> {
  return ([
    {
      file: "test/lua-real-script-turning-world-deck-ritual-target.test.ts",
      kind: "ritualDeckTargetLocation",
      families: ["ritual"],
      required: [
        "Ritual.CreateProc hand-or-Deck target locations",
        "parameter: 0x3",
        'location: "deck"',
        'summonType: "ritual"',
        "summonMaterialUids: [handRitualMaterial!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        'expect(restored.host.messages).not.toContain("turning responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-machine-angel-absolute-grave-ritual.test.ts",
      kind: "ritualGraveExtraMaterial",
      families: ["ritual"],
      required: [
        'operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }])',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }])",
        'summonType: "ritual"',
        "summonMaterialUids: [handMaterial!.uid, graveMaterial!.uid]",
        "reason: duelReason.release | duelReason.material | duelReason.ritual",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        'eventName === "sentToDeck"',
        'expect(restored.host.messages).not.toContain("machine angel absolute responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-chaos-form-grave-ritual.test.ts",
      kind: "ritualGraveBanishMaterial",
      families: ["ritual"],
      required: [
        "restores a Ritual procedure that banishes a Graveyard Blue-Eyes material",
        "operationInfos).toEqual([",
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        "{ category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x10 }",
        "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }",
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([blueEyes!.uid])",
        'eventName === "specialSummoned"',
        'eventName === "banished"',
        "location: \"banished\", reason: duelReason.material | duelReason.ritual",
        'expect(restored.host.messages).not.toContain("chaos form responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-nekroz-divinemirror-extra-deck-ritual.test.ts",
      kind: "ritualExtraDeckMaterial",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x22 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x22 }])",
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([nekrozExtraMaterialA!.uid, nekrozExtraMaterialB!.uid])",
        "reason: duelReason.material | duelReason.ritual",
        'location: "extraDeck"',
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        'expect(restored.host.messages).not.toContain("nekroz divinemirror responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-contract-dark-master-ritual-spell.test.ts",
      kind: "ritualGreaterCode",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }])",
        'summonType: "ritual"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName: "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "expect(materialGraveEvents.map((event) => event.eventCardUid).sort()).toEqual([materialA!.uid, materialB!.uid].sort())",
        'expect(restored.host.messages).not.toContain("dark master responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-branded-fusion-deck-material.test.ts",
      kind: "fusionDeckMaterialOath",
      families: ["fusion"],
      required: [
        "expect(chainLink.operationInfos).toEqual([",
        "expect(restoredChainLink.operationInfos).toEqual([",
        "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }",
        "{ category: 0x20, targetUids: [], count: 0, player: 0, parameter: 0x7 }",
        'summonType: "fusion"',
        "summonMaterialUids: [albaz!.uid, material!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === material!.uid",
        "special-summon-limit:non-fusion-extra",
        'expect(restored.host.messages).not.toContain("branded fusion responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-dyna-base-forced-handler-fusion.test.ts",
      kind: "fusionForcedHandler",
      families: ["fusion"],
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [dynaBase!.uid, material!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "expect(restored.session.state.cards.find((card) => card.uid === decoyMaterial!.uid)).toMatchObject({ location: \"hand\", controller: 0 })",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === dynaBase!.uid",
        'expect(restored.host.messages).not.toContain("dyna responder resolved")',
        "getLegalActions(session, 0).find((action) => action.type === \"activateEffect\" && action.uid === dynaBase!.uid)).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-earth-chant-ritual-equal.test.ts",
      kind: "ritualEqualLevel",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x12 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        'summonType: "ritual"',
        "summonMaterialUids: [materialA!.uid, materialC!.uid]",
        "summonMaterialUids: [exactMaterial!.uid]",
        "summonMaterialUids: [darkMagician!.uid]",
        "summonMaterialUids: [validMaterial!.uid]",
        'eventName: "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "expect(materialGraveEvents.map((event) => event.eventCardUid).sort()).toEqual([materialA!.uid, materialC!.uid].sort())",
        'expect(restored.host.messages).not.toContain("earth chant responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-miracle-raven-self-ritual.test.ts",
      kind: "ritualSelfProcedure",
      families: ["ritual"],
      required: [
        "operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x200 }])",
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x200 }])",
        'summonType: "ritual"',
        "summonMaterialUids: [material!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        'expect(restored.host.messages).not.toContain("miracle raven responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-mutiny-sky-shuffle-fusion-material.test.ts",
      kind: "fusionShuffleMaterial",
      families: ["fusion"],
      required: [
        "expect(chainLink.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        "restoredChainLink.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        'summonType: "fusion"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        "location: \"deck\"",
        'eventName: "moved"',
        "eventUids: [materialA!.uid, materialB!.uid]",
        'eventName: "specialSummoned"',
        'expect(restored.host.messages).not.toContain("mutiny responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-magikey-duo-defense-ritual.test.ts",
      kind: "ritualSelectOptionSumpos",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x8, targetUids: [graveTarget!.uid], count: 1, player: 0, parameter: 0 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x8, targetUids: [graveTarget!.uid], count: 1, player: 0, parameter: 0 }])",
        'position: "faceUpDefense"',
        'summonType: "ritual"',
        "summonMaterialUids: [material!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToHand"',
        'eventName === "sentToGraveyard"',
        'expect(restored.host.messages).not.toContain("magikey duo responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-magikey-maftea-deck-ritual.test.ts",
      kind: "ritualDeckExtraop",
      families: ["ritual"],
      required: [
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([handMaterial!.uid, faceupNormal!.uid, deckNormalMaterial!.uid])",
        "reason: duelReason.release | duelReason.material | duelReason.ritual",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === deckNormalMaterial!.uid",
        "restores non-sentinel SelectOption into Ritual extra material extraop",
        'expect(restored.host.messages).not.toContain("magikey maftea responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-megalith-unformed-deck-ritual.test.ts",
      kind: "ritualOperationReassigned",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        'position: "faceUpDefense"',
        'summonType: "ritual"',
        "summonMaterialUids: [material!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        'expect(restored.host.messages).not.toContain("megalith unformed responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-advanced-ritual-art-extra-material.test.ts",
      kind: "ritualExtraMaterialNormalDeck",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([normalMaterialB!.uid, normalMaterialA!.uid])",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'eventName: "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === normalMaterialB!.uid",
        'expect(restored.host.messages).not.toContain("advanced ritual art responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-arcana-force-chaos-ruler-contact-fusion.test.ts",
      kind: "contactFusionOpponentMaterial",
      families: ["fusion"],
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [ownMaterialA!.uid, ownMaterialB!.uid, opponentMaterial!.uid]",
        "reason: duelReason.cost | duelReason.material",
        'eventName: "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === opponentMaterial!.uid",
        "expect(restored.session.state.cards.find((card) => card.uid === opponentMaterial!.uid)).toMatchObject({",
        "expect(materialGraveEvents.map((event) => event.eventCardUid).sort()).toEqual([ownMaterialA!.uid, ownMaterialA!.uid, ownMaterialB!.uid, opponentMaterial!.uid].sort())",
        "expect(getLegalActions(restored.session, 0).some((action) => action.type === \"specialSummonProcedure\" && action.uid === chaosRuler!.uid)).toBe(false)",
        "restores a Contact Fusion procedure that sends an opponent field material to its Graveyard",
      ],
    },
    {
      file: "test/lua-real-script-dark-fusion-stage2-protection.test.ts",
      kind: "fusionStage2Protection",
      families: ["fusion"],
      required: [
        "expect(session.state.chain[0]!.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        "expect(restoredChain.session.state.chain[0]!.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        'summonType: "fusion"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === materialB!.uid",
        'luaValueDescriptor: "cannot-be-effect-target:opponent"',
        "property: 0x10",
        'range: ["hand"]',
        "expect(getLuaRestoreLegalActions(restoredProtected, 1).find((action) => action.type === \"activateEffect\" && action.uid === opponentTarget!.uid)).toBeUndefined()",
        'expect(restoredProtected.host.messages).not.toContain("dark fusion target responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-forbidden-arts-gishki-opponent-ritual.test.ts",
      kind: "ritualOpponentFieldMaterial",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }])",
        'summonType: "ritual"',
        "expect(summonedRitual!.summonMaterialUids).toEqual([ownFieldMaterial!.uid, opponentFieldMaterial!.uid])",
        "reason: duelReason.release | duelReason.material | duelReason.ritual",
        "controller: 1, reason: duelReason.release | duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "effect.code === 101",
      ],
    },
    {
      file: "test/lua-real-script-gladiator-beast-andabata-contact-fusion.test.ts",
      kind: "contactFusionCustomSummonType",
      families: ["fusion"],
      required: [
        'summonType: "special"',
        "summonTypeCode: luaSummonTypeSpecial + 1",
        "summonMaterialUids: [specificMaterial!.uid, gladiatorMaterialA!.uid, gladiatorMaterialB!.uid]",
        "reason: duelReason.cost | duelReason.material",
        'eventName: "specialSummoned"',
        'eventName === "sentToDeck"',
        "event.eventCardUid === gladiatorMaterialB!.uid",
        "expect(materialDeckEvents.map((event) => event.eventCardUid).sort()).toEqual([",
        "expect(restored.session.state.pendingTriggers.some((trigger) => trigger.sourceUid === andabata!.uid && trigger.eventName === \"specialSummoned\")).toBe(true)",
        "expect(getLegalActions(restored.session, 0).some((action) => action.type === \"activateTrigger\" && action.uid === andabata!.uid)).toBe(true)",
        "expect(getLegalActions(restored.session, 0).some((action) => action.type === \"specialSummonProcedure\" && action.uid === andabata!.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-high-ritual-art-deck-stage2.test.ts",
      kind: "ritualStage2",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }])",
        'summonType: "ritual"',
        "summonMaterialUids: [normalMaterial!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === normalMaterial!.uid",
        "ownerType: \"card\", ownerId: ritualTarget!.uid",
        "reason: duelReason.effect",
        'expect(restored.host.messages).not.toContain("high ritual art responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-ladys-dragonmaid-contact-fusion.test.ts",
      kind: "contactFusionBanish",
      families: ["fusion"],
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [fieldMaterial!.uid, graveMaterial!.uid]",
        "reason: duelReason.cost | duelReason.material",
        "expect(restored.session.state.cards.find((card) => card.uid === graveMaterial!.uid)).toMatchObject({",
        'eventName: "specialSummoned"',
        'eventName === "banished"',
        "event.eventCardUid === graveMaterial!.uid",
        "expect(materialBanishEvents.map((event) => event.eventCardUid).sort()).toEqual([fieldMaterial!.uid, fieldMaterial!.uid, graveMaterial!.uid].sort())",
        "expect(getLegalActions(restored.session, 0).some((action) => action.type === \"specialSummonProcedure\" && action.uid === ladysDragonmaid!.uid)).toBe(false)",
        "restores a Contact Fusion procedure that banishes selected field and Graveyard materials",
      ],
    },
    {
      file: "test/lua-real-script-vendread-reunion-custom-ritual.test.ts",
      kind: "customRitualOperation",
      families: ["ritual"],
      required: [
        'summonType: "ritual"',
        "expect(summonedRitual!.summonMaterialUids).toEqual([materialA!.uid, materialB!.uid])",
        "reason: duelReason.release | duelReason.effect | duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === materialA!.uid",
        "event.eventCardUid === materialB!.uid",
        "expect(restored.host.messages).toEqual([",
        "restores a custom Ritual operation that sets, releases, and Ritual Summons with banished materials",
      ],
    },
    {
      file: "test/lua-real-script-heavy-polymerization-partial-extraop.test.ts",
      kind: "fusionPartialExtraop",
      families: ["fusion"],
      required: [
        "expect(chainLink.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        "expect(chainLink.possibleOperationInfos).toEqual([{ category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        "expect(restoredChainLink.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        "expect(restoredChainLink.possibleOperationInfos).toEqual([{ category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        'summonType: "fusion"',
        "summonMaterialUids: [handMaterialA!.uid, handMaterialB!.uid, extraMaterial!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "reason: duelReason.material | duelReason.fusion",
        'eventName === "specialSummoned"',
        'eventName === "banished"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === handMaterialB!.uid",
        'expect(restored.host.messages).not.toContain("heavy polymerization responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-fallen-of-albaz-opponent-fusion.test.ts",
      kind: "fusionOpponentExtrafil",
      families: ["fusion"],
      required: [
        "reason: duelReason.cost | duelReason.discard",
        "expect(session.state.cards.find((card) => card.uid === discardCost!.uid)).toMatchObject({",
        'summonType: "fusion"',
        "summonMaterialUids: [albaz!.uid, opponentMaterial!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === opponentMaterial!.uid",
        "expect(materialGraveEvents.map((event) => event.eventCardUid).sort()).toEqual([albaz!.uid, opponentMaterial!.uid].sort())",
        'expect(restored.host.messages).not.toContain("fallen of albaz responder resolved")',
        "does not expose the summon-success trigger when the Fusion target cannot use Albaz",
      ],
    },
    {
      file: "test/lua-real-script-miracle-fusion-extra-material.test.ts",
      kind: "fusionGraveBanishMaterial",
      families: ["fusion"],
      required: [
        "expect(chainLink.operationInfos).toEqual(",
        "expect(restoredChainLink.operationInfos).toEqual(",
        "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }",
        "{ category: 0x4, targetUids: [], count: 1, player: 0, parameter: 0x14 }",
        'summonType: "fusion"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        'eventName: "specialSummoned"',
        'eventName: "banished"',
        "eventCardUid: materialB!.uid",
        'expect(restored.host.messages).not.toContain("miracle fusion responder resolved")',
        "restores graveyard Fusion materials and banishes them through Fusion.BanishMaterial",
      ],
    },
    { file: "test/lua-real-script-black-skull-dragon-addprocmix-fusion.test.ts", kind: "fusionAddProcMixMaterialMetadata", families: ["fusion"], required: ["Fusion.AddProcMix material metadata", "expect(blackSkull!.data.fusionMaterials).toEqual([summonedSkullCode, redEyesCode])", "expect(restored.session.state.cards.find((card) => card.uid === blackSkull!.uid)?.data.fusionMaterials).toEqual([summonedSkullCode, redEyesCode])", "operationInfos).toEqual([", "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }", 'summonType: "fusion"', "summonMaterialUids: [summonedSkull!.uid, redEyes!.uid]", "reason: duelReason.effect | duelReason.material | duelReason.fusion", 'eventName === "usedAsMaterial"', 'eventName === "specialSummoned"', 'expect(restored.host.messages).not.toContain("black skull dragon responder resolved")'] },
    { file: "test/lua-real-script-blue-eyes-ultimate-addproccoderep-fusion.test.ts", kind: "fusionAddProcCodeRepRepeatedCodeMetadata", families: ["fusion"], required: ["Fusion.AddProcCodeRep metadata", "expect(blueEyesUltimate!.data.fusionMaterials).toEqual([blueEyesCode, blueEyesCode, blueEyesCode])", "expect(restored.session.state.cards.find((card) => card.uid === blueEyesUltimate!.uid)?.data.fusionMaterials).toEqual([blueEyesCode, blueEyesCode, blueEyesCode])", "operationInfos).toEqual([", "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }", 'summonType: "fusion"', "summonMaterialUids: blueEyesMaterials.map((card) => card.uid)", "reason: duelReason.effect | duelReason.material | duelReason.fusion", 'eventName === "usedAsMaterial"', 'eventName === "specialSummoned"', 'expect(restored.host.messages).not.toContain("blue-eyes ultimate responder resolved")'] },
    { file: "test/lua-real-script-earthbound-geo-kraken-addprocfunrep-fusion.test.ts", kind: "fusionAddProcFunRepSetcodeMetadata", families: ["fusion"], required: ["Fusion.AddProcFunRep metadata", "expect(geoKraken!.data).toMatchObject({ fusionMaterialMin: 2, fusionMaterialMax: 2, fusionMaterialSetcode: setEarthbound })", "expect(directFusionActions[0]!.materialUids).toEqual(earthboundMaterials.map((card) => card.uid))", "directFusionActions.some((action) => action.materialUids.includes(offSetDecoy!.uid))", "summonMaterialUids: earthboundMaterials.map((card) => card.uid)"] },
    { file: "test/lua-real-script-marine-neos-addproccode2-contact-fusion.test.ts", kind: "fusionAddProcCode2ExactCodeMetadata", families: ["fusion"], required: ["Fusion.AddProcCode2 exact material metadata", "expect(marineNeos!.data.fusionMaterials).toEqual([neosCode, marineDolphinCode])", "expect(restored.session.state.cards.find((card) => card.uid === marineNeos!.uid)?.data.fusionMaterials).toEqual([neosCode, marineDolphinCode])", 'summonType: "fusion"', "summonMaterialUids: [neos!.uid, marineDolphin!.uid]", "reason: duelReason.cost | duelReason.material", 'eventName === "sentToDeck"', 'eventName === "specialSummoned"', "expect(getLegalActions(restored.session, 0).some((action) => action.type === \"specialSummonProcedure\" && action.uid === marineNeos!.uid)).toBe(false)"] },
    { file: "test/lua-real-script-cyber-end-dragon-addprocmixn-fusion.test.ts", kind: "fusionAddProcMixNRepeatedCodeMetadata", families: ["fusion"], required: ["Fusion.AddProcMixN metadata", "expect(cyberEnd!.data.fusionMaterials).toEqual([cyberDragonCode, cyberDragonCode, cyberDragonCode])", "expect(restored.session.state.cards.find((card) => card.uid === cyberEnd!.uid)?.data.fusionMaterials).toEqual([cyberDragonCode, cyberDragonCode, cyberDragonCode])", "operationInfos).toEqual([", "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }", 'summonType: "fusion"', "summonMaterialUids: cyberDragons.map((card) => card.uid)", "reason: duelReason.effect | duelReason.material | duelReason.fusion", 'eventName === "usedAsMaterial"', 'eventName === "specialSummoned"', 'expect(restored.host.messages).not.toContain("cyber end responder resolved")'] },
    { file: "test/lua-real-script-vision-hero-trinity-addprocmixn-setcode-fusion.test.ts", kind: "fusionAddProcMixNSetcodeMetadata", families: ["fusion"], required: ["Fusion.AddProcMixN setcode metadata", "expect(trinity!.data).toMatchObject({ fusionMaterialMin: 3, fusionMaterialMax: 3, fusionMaterialSetcode: setHero })", "expect(trinity!.data.fusionMaterials).toBeUndefined()", "expect(directFusionActions[0]!.materialUids).toEqual(heroMaterials.map((card) => card.uid))", "directFusionActions.some((action) => action.materialUids.includes(nonHero!.uid))", "summonMaterialUids: heroMaterials.map((card) => card.uid)"] },
    { file: "test/lua-real-script-elder-entity-norden-addprocmixn-plus-type-fusion.test.ts", kind: "fusionAddProcMixNRepeatedPlusTypeMetadata", families: ["fusion"], required: ["Fusion.AddProcMixN plus-type metadata", "fusionMaterialType: typeXyz | typeSynchro", "expect(directFusionActions[0]!.materialUids).toEqual(materials.map((card) => card.uid))", "directFusionActions.some((action) => action.materialUids.includes(fusionDecoy!.uid))", "summonMaterialUids: materials.map((card) => card.uid)"] },
    { file: "test/lua-real-script-ultimate-ancient-gear-golem-addprocmixn-mixed-fusion.test.ts", kind: "fusionAddProcMixNMixedMetadata", families: ["fusion"], required: ["Fusion.AddProcMixN mixed metadata", "expect(ultimateGolem!.data).toMatchObject({ fusionMaterials: [ancientGearGolemCode], fusionMaterialMin: 2, fusionMaterialMax: 2, fusionMaterialSetcode: setAncientGear })", "expect(directFusionActions[0]!.materialUids).toEqual([ancientGearGolem!.uid, ...ancientGearMaterials.map((card) => card.uid)])", "directFusionActions.some((action) => action.materialUids.includes(offSet!.uid))", "summonMaterialUids: [ancientGearGolem!.uid, ...ancientGearMaterials.map((card) => card.uid)]"] },
    { file: "test/lua-real-script-metalfoes-crimsonite-addprocmixn-atk-below-fusion.test.ts", kind: "fusionAddProcMixNRepeatedAttackBelowMetadata", families: ["fusion"], required: ["Fusion.AddProcMixN attack-below repeated metadata", "expect(crimsonite!.data).toMatchObject({", "fusionMaterialAttackMax: 3000", "fusionRequiredMaterialSetcodes: [setMetalfoes]", "expect(directFusionActions[0]!.materialUids).toEqual([metalfoesMaterial!.uid, ...lowMaterials.map((card) => card.uid)])", "directFusionActions.some((action) => action.materialUids.includes(highDecoy!.uid))", "summonMaterialUids: [metalfoesMaterial!.uid, ...lowMaterials.map((card) => card.uid)]"] },
    { file: "test/lua-real-script-mirrorjade-addprocmix-plus-type-fusion.test.ts", kind: "fusionAddProcMixPlusTypePredicateMetadata", families: ["fusion"], required: ["Fusion.AddProcMix plus-type metadata", "expect(mirrorjade!.data.fusionRequiredMaterialPredicates).toEqual([{ type: typeFusion | typeSynchro | typeXyz | typeLink }])", "expect(mirrorjade!.data.fusionMaterials).toEqual([albazCode])", "expect(directFusionActions[0]!.materialUids).toEqual([albaz!.uid, linkMaterial!.uid])", "directFusionActions.some((action) => action.materialUids.includes(normalDecoy!.uid))", "summonMaterialUids: [albaz!.uid, linkMaterial!.uid]"] },
    { file: "test/lua-real-script-dracotail-shaulas-addprocmix-predicate-fusion.test.ts", kind: "fusionAddProcMixPredicateMetadata", families: ["fusion"], required: ["Fusion.AddProcMix predicate metadata", "expect(shaulas!.data.fusionRequiredMaterialPredicates).toEqual([{ setcode: setDracotail }, { location: locationHand }])", "expect(shaulas!.data.fusionMaterials).toBeUndefined()", "expect(directFusionActions[0]!.materialUids).toEqual([dracotailMaterial!.uid, handMaterial!.uid])", "summonMaterialUids: [dracotailMaterial!.uid, handMaterial!.uid]"] },
    { file: "test/lua-real-script-metalfoes-adamante-addprocmix-atk-below-fusion.test.ts", kind: "fusionAddProcMixAttackBelowPredicateMetadata", families: ["fusion"], required: ["Fusion.AddProcMix attack-below predicate metadata", "expect(adamante!.data.fusionRequiredMaterialPredicates).toEqual([{ setcode: setMetalfoes }, { attackMax: 2500 }])", "expect(adamante!.data.fusionMaterials).toBeUndefined()", "expect(directFusionActions[0]!.materialUids).toEqual([metalfoesMaterial!.uid, lowMaterial!.uid])", "directFusionActions.some((action) => action.materialUids.includes(highDecoy!.uid))", "summonMaterialUids: [metalfoesMaterial!.uid, lowMaterial!.uid]"] },
    { file: "test/lua-real-script-titaniklad-addprocmix-attack-fusion.test.ts", kind: "fusionAddProcMixAttackPredicateMetadata", families: ["fusion"], required: ["Fusion.AddProcMix attack predicate metadata", "expect(titaniklad!.data.fusionRequiredMaterialPredicates).toEqual([{ attackMin: 2500 }])", "expect(directFusionActions[0]!.materialUids).toEqual([albaz!.uid, highMaterial!.uid])", "directFusionActions.some((action) => action.materialUids.includes(lowDecoy!.uid))", "summonMaterialUids: [albaz!.uid, highMaterial!.uid]"] },
    { file: "test/lua-real-script-chimeratech-rampage-addprocmixrep-fusion.test.ts", kind: "fusionAddProcMixRepSetcodeMetadata", families: ["fusion"], required: ["Fusion.AddProcMixRep metadata", "expect(rampage!.data.fusionMaterialMin).toBe(2)", "expect(rampage!.data.fusionMaterialSetcode).toBe(setCyberDragon)", "summonMaterialUids: [cyberDragon!.uid, cyberDragonCore!.uid]", "expect(restored.session.state.cards.find((card) => card.uid === decoy!.uid)).toMatchObject({ location: \"hand\", controller: 0 })"] },
    { file: "test/lua-real-script-dracotail-arthalion-addprocmixrep-location-fusion.test.ts", kind: "fusionAddProcMixRepLocationMetadata", families: ["fusion"], required: ["Fusion.AddProcMixRep location metadata", "expect(arthalion!.data.fusionMaterialLocation).toBe(locationHand)", "expect(directFusionActions[0]!.materialUids).toEqual([dracotailMaterial!.uid, handMaterial!.uid])", "directFusionActions.some((action) => action.materialUids.includes(fieldDecoy!.uid))", "summonMaterialUids: [dracotailMaterial!.uid, handMaterial!.uid]"] },
    { file: "test/lua-real-script-primite-dragon-nether-berzelius-addprocmixrep-setcode-fusion.test.ts", kind: "fusionAddProcMixRepRequiredSetcodeMetadata", families: ["fusion"], required: ["Fusion.AddProcMixRep setcode metadata", "expect(berzelius!.data.fusionRequiredMaterialSetcodes).toEqual([setPrimite])", "expect(berzelius!.data.fusionMaterialType).toBe(typeNormal)", "directFusionActions.every((action) => action.materialUids.includes(primiteMaterial!.uid))", "summonMaterialUids: [primiteMaterial!.uid, normalMaterial!.uid]"] },
    { file: "test/lua-real-script-thunder-dragon-colossus-addprocmixrep-code-fusion.test.ts", kind: "fusionAddProcMixRepExactCodeMetadata", families: ["fusion"], required: ["Fusion.AddProcMixRep exact-code metadata", "expect(colossus!.data.fusionMaterials).toEqual([thunderDragonCode])", "expect(colossus!.data.fusionMaterialRace).toBe(raceThunder)", "directFusionActions.every((action) => action.materialUids.length === 2 && action.materialUids.includes(thunderDragon!.uid))", "summonMaterialUids: [thunderDragon!.uid, thunderDecoy!.uid]"] },
    {
      file: "test/lua-real-script-necroquip-princess-contact-fusion.test.ts",
      kind: "contactFusionSendCost",
      families: ["fusion"],
      required: [
        'summonType: "fusion"',
        "summonMaterialUids: [equippedMaterial!.uid, fiendMaterial!.uid]",
        "reason: duelReason.cost | duelReason.material",
        "expect(restored.session.state.cards.find((card) => card.uid === fiendMaterial!.uid)).toMatchObject({",
        'eventName: "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === fiendMaterial!.uid",
        "expect(materialGraveEvents.map((event) => event.eventCardUid).sort()).toEqual([equippedMaterial!.uid, equippedMaterial!.uid, fiendMaterial!.uid].sort())",
        "expect(getLegalActions(restored.session, 0).some((action) => action.type === \"specialSummonProcedure\" && action.uid === necroquip!.uid)).toBe(false)",
        "restores a Contact Fusion procedure that sends selected materials as cost",
      ],
    },
    {
      file: "test/lua-real-script-polymerization-fusion-summon.test.ts",
      kind: "fusionHandMaterial",
      families: ["fusion"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }]',
        'summonType: "fusion"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        "summonMaterialUids: [goddess!.uid, materialB!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        'eventName === "usedAsMaterial"',
        "event.eventCardUid === goddess!.uid",
        'expect(restored.host.messages).not.toContain("polymerization responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-prank-kids-pandemonium-stage2-oath.test.ts",
      kind: "fusionStage2Oath",
      families: ["fusion"],
      required: [
        "expect(session.state.chain[0]!.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        "expect(restored.session.state.chain[0]!.operationInfos).toEqual([{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }])",
        'summonType: "fusion"',
        "summonMaterialUids: [materialA!.uid, materialB!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === materialB!.uid",
        'expect(restored.host.messages).not.toContain("pandemonium responder resolved")',
        'luaTargetDescriptor: "target:not-setcode:288"',
        "actions.some((action) => action.type === \"normalSummon\" && action.uid === nonPrankNormal!.uid)).toBe(false)",
        "actions.some((action) => action.type === \"specialSummonProcedure\" && action.uid === nonPrankSpecial!.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-prayers-ritual-matfilter.test.ts",
      kind: "ritualMaterialFilter",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        'summonType: "ritual"',
        "summonMaterialUids: [lightMaterialA!.uid, lightMaterialB!.uid]",
        "expect(restored.session.state.cards.find((card) => card.uid === darkMaterial!.uid)).toMatchObject({ location: \"hand\" })",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === lightMaterialB!.uid",
        'expect(restored.host.messages).not.toContain("voiceless responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-primite-fusion-extra-check.test.ts",
      kind: "fusionFcheck",
      families: ["fusion"],
      required: [
        "expect(restoredChainLink.operationInfos).toEqual([",
        "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 }",
        "{ category: 0x10, targetUids: [], count: 1, player: 0, parameter: 0x3c }",
        'summonType: "fusion"',
        "summonMaterialUids: [normalMaterial!.uid, effectMaterial!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        'eventName === "specialSummoned"',
        'eventName === "sentToDeck"',
        "event.eventCardUid === normalMaterial!.uid",
        'expect(restored.host.messages).not.toContain("primite responder resolved")',
        "does not expose Primite Fusion when the selected material set has no Normal Monster",
      ],
    },
    {
      file: "test/lua-real-script-rebirth-nephthys-stage2.test.ts",
      kind: "ritualStage2",
      families: ["ritual"],
      required: [
        'operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x2 }]',
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        'summonType: "ritual"',
        "summonMaterialUids: [material!.uid]",
        "reason: duelReason.material | duelReason.ritual",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        'eventName === "destroyed"',
        "reason: duelReason.destroy | duelReason.effect",
        'expect(restored.host.messages).not.toContain("rebirth of nephthys responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-secrets-dark-magic-fusion-matcheck.test.ts",
      kind: "fusionMaterialCheck",
      families: ["fusion"],
      required: [
        "expect(session.state.chain[0]!.operationInfos).toEqual([",
        "expect(restored.session.state.chain[0]!.operationInfos).toEqual([",
        'summonType: "fusion"',
        "summonMaterialUids: [darkMagician!.uid, material!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        'eventName === "specialSummoned"',
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === darkMagician!.uid",
        'expect(restored.host.messages).not.toContain("secrets responder resolved")',
        "does not expose the Fusion activation when no selected material is Dark Magician or Dark Magician Girl",
      ],
    },
    {
      file: "test/lua-real-script-super-soldier-synthesis-specific-material.test.ts",
      kind: "ritualSpecificMaterial",
      families: ["ritual"],
      required: [
        "{ category: 0x20, targetUids: [], count: 1, player: 0, parameter: 0x3 }",
        "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x12 }",
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([",
        'summonType: "ritual"',
        "summonMaterialUids).toEqual([handLightMaterial!.uid, deckDarkMaterial!.uid])",
        "reason: duelReason.effect | duelReason.material | duelReason.ritual",
        'eventName === "sentToGraveyard"',
        "event.eventCardUid === handLightMaterial!.uid",
        'expect(restored.host.messages).not.toContain("super soldier synthesis responder resolved")',
      ],
    },
  ] satisfies Array<{ file: string; kind: RitualFusionHelperKind; families: RitualFusionHelperFamily[]; required: string[] }>).sort((a, b) => a.file.localeCompare(b.file));
}
