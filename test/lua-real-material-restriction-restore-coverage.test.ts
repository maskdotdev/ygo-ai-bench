import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const MATERIAL_RESTRICTION_FIXTURE_COUNT = 4;
const materialRestrictionKindCounts = {
  fusionMaterialSetcodeLock: 1,
  rankUpMagicXyzTargetLock: 1,
  specialSummonTunerLock: 1,
  synchroMaterialSetcodeLock: 1,
} satisfies Record<MaterialRestrictionKind, number>;
const materialRestrictionSemanticVariantCounts = {
  concoursOwnPlayerFusionMaterialSetcodeLock: 1,
  kewlTuneTunerOnlySpecialSummonLock: 1,
  necroVultureRankUpMagicRelatedXyzLock: 1,
  rGenexOracleTargetFilteredSynchroMaterialLock: 1,
} satisfies Record<MaterialRestrictionSemanticVariant, number>;

type MaterialRestrictionKind =
  | "fusionMaterialSetcodeLock"
  | "rankUpMagicXyzTargetLock"
  | "specialSummonTunerLock"
  | "synchroMaterialSetcodeLock";
type MaterialRestrictionSemanticVariant =
  | "concoursOwnPlayerFusionMaterialSetcodeLock"
  | "kewlTuneTunerOnlySpecialSummonLock"
  | "necroVultureRankUpMagicRelatedXyzLock"
  | "rGenexOracleTargetFilteredSynchroMaterialLock";

describe("Lua real material restriction restore coverage", () => {
  it("requires material and special-summon restriction fixtures to assert clean restore and restored gates", () => {
    const files = restrictionFixtureFiles();
    expect(files).toHaveLength(MATERIAL_RESTRICTION_FIXTURE_COUNT);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps material restriction fixture kinds explicit", () => {
    expect(countMaterialRestrictionKinds(restrictionFixtureFiles())).toEqual(materialRestrictionKindCounts);
  });

  it("keeps named material restriction semantic variants explicit", () => {
    expect(countMaterialRestrictionSemanticVariants(materialRestrictionSemanticVariants())).toEqual(
      materialRestrictionSemanticVariantCounts,
    );

    const weak = materialRestrictionSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function restrictionFixtureFiles(): Array<{
  file: string;
  kind: MaterialRestrictionKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-necro-vulture-rank-up-magic-xyz-lock.test.ts",
      kind: "rankUpMagicXyzTargetLock",
      required: [
        "target:xyz-summon-not-related-setcode:149",
        "luaSummonTypeXyz",
        "targetCardPredicate",
        "luaBaseEffectId(offSetEffectId!)",
        "luaBaseEffectId(rumEffectId!)",
        "toBe(true)",
        "toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-concours-material-lock.test.ts",
      kind: "fusionMaterialSetcodeLock",
      required: [
        "code: 248",
        "target:not-setcode-any:",
        "cannot-material:controller-summon-types:",
        "property: 0x180",
        "targetRange: [0x3ff, 0x3ff]",
        "fusionSummonDuelCard(restored.session.state, 0, blockedFusion!.uid",
        "cannot be used as fusion material",
        "fusionSummonDuelCard(restored.session.state, 1, opponentFusion!.uid",
        "fusionSummonDuelCard(restored.session.state, 0, allowedFusion!.uid",
      ],
    },
    {
      file: "test/lua-real-script-kewl-tune-synchro-tuner-lock.test.ts",
      kind: "specialSummonTunerLock",
      required: [
        "Duel.IsPlayerCanSpecialSummon",
        "Duel.SpecialSummon(non_tuner",
        "Duel.SpecialSummon(tuner",
        "kewl tune can special true/false",
        "kewl tune non-tuner special 0",
        "kewl tune tuner special 1",
      ],
    },
    {
      file: "test/lua-real-script-r-genex-oracle-synchro-material-lock.test.ts",
      kind: "synchroMaterialSetcodeLock",
      required: [
        "code: 236",
        "cannot-material:target-not-setcode:2",
        'action.type === "synchroSummon"',
        "synchroSummonDuelCard(restored.session.state",
        "cannot be used as synchro material",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: MaterialRestrictionKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countMaterialRestrictionKinds(
  fixtures: Array<{ kind: MaterialRestrictionKind }>,
): Record<MaterialRestrictionKind, number> {
  return fixtures.reduce<Record<MaterialRestrictionKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      fusionMaterialSetcodeLock: 0,
      rankUpMagicXyzTargetLock: 0,
      specialSummonTunerLock: 0,
      synchroMaterialSetcodeLock: 0,
    },
  );
}

function materialRestrictionSemanticVariants(): Array<{
  file: string;
  kind: MaterialRestrictionSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-concours-material-lock.test.ts",
      kind: "concoursOwnPlayerFusionMaterialSetcodeLock",
      required: [
        'const concoursCode = "14283055"',
        "restores its own-player non-Nouvelles/non-Patissciel material lock",
        "cannot-material:controller-summon-types:",
        "fusionSummonDuelCard(restored.session.state, 0, blockedFusion!.uid",
      ],
    },
    {
      file: "test/lua-real-script-kewl-tune-synchro-tuner-lock.test.ts",
      kind: "kewlTuneTunerOnlySpecialSummonLock",
      required: [
        'const kewlTuneCode = "78058681"',
        "restores official temporary EFFECT_CANNOT_SPECIAL_SUMMON that allows only Tuners",
        "kewl tune can special true/false",
        "kewl tune tuner special 1",
      ],
    },
    {
      file: "test/lua-real-script-necro-vulture-rank-up-magic-xyz-lock.test.ts",
      kind: "necroVultureRankUpMagicRelatedXyzLock",
      required: [
        'const necroVultureCode = "51814159"',
        "restores its related-effect Rank-Up-Magic Xyz special summon lock",
        "target:xyz-summon-not-related-setcode:149",
        "luaBaseEffectId(rumEffectId!)",
      ],
    },
    {
      file: "test/lua-real-script-r-genex-oracle-synchro-material-lock.test.ts",
      kind: "rGenexOracleTargetFilteredSynchroMaterialLock",
      required: [
        'const oracleCode = "10178757"',
        "restores official target-filtered EFFECT_CANNOT_BE_SYNCHRO_MATERIAL",
        "cannot-material:target-not-setcode:2",
        "cannot be used as synchro material",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: MaterialRestrictionSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countMaterialRestrictionSemanticVariants(
  fixtures: Array<{ kind: MaterialRestrictionSemanticVariant }>,
): Record<MaterialRestrictionSemanticVariant, number> {
  return fixtures.reduce<Record<MaterialRestrictionSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      concoursOwnPlayerFusionMaterialSetcodeLock: 0,
      kewlTuneTunerOnlySpecialSummonLock: 0,
      necroVultureRankUpMagicRelatedXyzLock: 0,
      rGenexOracleTargetFilteredSynchroMaterialLock: 0,
    },
  );
}
