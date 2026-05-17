import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const LIZARD_DESCRIPTOR_FIXTURE_COUNT = 18;
const LIZARD_ALL_CARD_FIXTURE_COUNT = 1;
const lizardDescriptorKindCounts = {
  currentAttribute: 1,
  currentSetcode: 1,
  descriptorlessFieldLock: 2,
  mixedOriginalTraitDescriptors: 1,
  notOriginalSetcodeTargetRange: 2,
  originalAttributeRace: 1,
  originalRace: 1,
  originalTripleTrait: 1,
  originalType: 2,
  originalTypeAttribute: 2,
  originalTypeRace: 1,
  originalTypeRank: 1,
  positiveOriginalSetcode: 1,
  positiveOriginalType: 1,
} satisfies Record<LizardDescriptorKind, number>;
const lizardAllCardKindCounts = {
  allCardAuxTrue: 1,
} satisfies Record<LizardAllCardKind, number>;
const lizardSemanticVariantCounts = {
  amorphageGoliathAllLocationOriginalSetcodeLock: 1,
  amorphageSlothBothPlayerOriginalSetcodeLock: 1,
  continuousOriginalRankXyzLock: 1,
  continuousPositiveOriginalSetcodeLock: 1,
  continuousPositiveOriginalTypeLock: 1,
  icejadeRanCurrentAttributeLock: 1,
  mixedOriginalTraitDescriptorLocks: 1,
  originalAttributeRaceLock: 1,
  originalAttributeTypeLock: 1,
  originalRaceTypeLock: 1,
  originalTraitOrLock: 1,
  originalTripleTraitLock: 1,
  orichalcosDescriptorlessFieldLock: 1,
  repairGenexAllCardAuxTrueLock: 1,
  scatterFusionCurrentSetcodeLock: 1,
  singleArgOriginalTypeLock: 1,
  sunvineShrineOriginalRaceLock: 1,
  whiteKnightDescriptorlessContinuousLock: 1,
  wildwindOriginalSynchroLock: 1,
} satisfies Record<LizardSemanticVariant, number>;

type LizardDescriptorKind =
  | "currentAttribute"
  | "currentSetcode"
  | "descriptorlessFieldLock"
  | "mixedOriginalTraitDescriptors"
  | "notOriginalSetcodeTargetRange"
  | "originalAttributeRace"
  | "originalRace"
  | "originalTripleTrait"
  | "originalType"
  | "originalTypeAttribute"
  | "originalTypeRace"
  | "originalTypeRank"
  | "positiveOriginalSetcode"
  | "positiveOriginalType";

type LizardAllCardKind = "allCardAuxTrue";
type LizardSemanticVariant =
  | "amorphageGoliathAllLocationOriginalSetcodeLock"
  | "amorphageSlothBothPlayerOriginalSetcodeLock"
  | "continuousOriginalRankXyzLock"
  | "continuousPositiveOriginalSetcodeLock"
  | "continuousPositiveOriginalTypeLock"
  | "icejadeRanCurrentAttributeLock"
  | "mixedOriginalTraitDescriptorLocks"
  | "originalAttributeRaceLock"
  | "originalAttributeTypeLock"
  | "originalRaceTypeLock"
  | "originalTraitOrLock"
  | "originalTripleTraitLock"
  | "orichalcosDescriptorlessFieldLock"
  | "repairGenexAllCardAuxTrueLock"
  | "scatterFusionCurrentSetcodeLock"
  | "singleArgOriginalTypeLock"
  | "sunvineShrineOriginalRaceLock"
  | "whiteKnightDescriptorlessContinuousLock"
  | "wildwindOriginalSynchroLock";

describe("Lua real Clock Lizard restore coverage", () => {
  it("requires representative Clock Lizard target descriptor fixtures to assert clean Lua registry restore", () => {
    const fixtures = representativeLizardDescriptorFixtures();
    expect(fixtures).toHaveLength(LIZARD_DESCRIPTOR_FIXTURE_COUNT);

    const missing = fixtures
      .filter(({ file, requireFalse = true, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("targetCardPredicate")
          || !text.includes("targetContext(restored.session.state")
          || !text.includes("toBe(true)")
          || (requireFalse && !text.includes("toBe(false)"))
          || !requiredSnippets.every((snippet) => hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps Clock Lizard descriptor fixture kinds explicit", () => {
    expect(countLizardDescriptorKinds(representativeLizardDescriptorFixtures())).toEqual(lizardDescriptorKindCounts);
  });

  it("requires all-card Clock Lizard fixtures to assert clean restore without descriptor predicates", () => {
    const fixtures = allCardLizardFixtures();
    expect(fixtures).toHaveLength(LIZARD_ALL_CARD_FIXTURE_COUNT);

    const missing = fixtures
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("luaTargetDescriptor).toBeUndefined()")
          || !text.includes("targetCardPredicate).toBeUndefined()")
          || !requiredSnippets.every((snippet) => hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps all-card Clock Lizard fixture kinds explicit", () => {
    expect(countLizardAllCardKinds(allCardLizardFixtures())).toEqual(lizardAllCardKindCounts);
  });

  it("keeps named Clock Lizard semantic variants explicit", () => {
    expect(countLizardSemanticVariants(lizardSemanticVariants())).toEqual(lizardSemanticVariantCounts);

    const weak = lizardSemanticVariants()
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function representativeLizardDescriptorFixtures(): Array<{
  file: string;
  kind: LizardDescriptorKind;
  requireFalse?: boolean;
  requiredSnippets: string[];
}> {
  return [
    {
      file: "test/lua-real-script-amorphage-goliath-continuous-lizard-lock.test.ts",
      kind: "notOriginalSetcodeTargetRange",
      requiredSnippets: [
        "Amorphage Goliath continuous Clock Lizard lock",
        'luaTargetDescriptor: `target:not-original-setcode:${setAmorphage}`',
        "targetRange: [locationAll, locationAll]",
      ],
    },
    {
      file: "test/lua-real-script-amorphage-sloth-target-range-lizard-lock.test.ts",
      kind: "notOriginalSetcodeTargetRange",
      requiredSnippets: [
        "Amorphage Sloth target-range Clock Lizard lock",
        'luaTargetDescriptor: `target:not-original-setcode:${setAmorphage}`',
        "targetRange: [0xff, 0xff]",
      ],
    },
    {
      file: "test/lua-real-script-single-arg-lizard-lock.test.ts",
      kind: "originalType",
      requiredSnippets: [
        "single-argument Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-type:64"',
        "single-arg-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-original-attribute-type-lizard-lock.test.ts",
      kind: "originalTypeAttribute",
      requiredSnippets: [
        "attribute-first original Type and Attribute Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-type-attribute:8192:32"',
        "original-attribute-type-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-original-race-type-lizard-lock.test.ts",
      kind: "originalTypeRace",
      requiredSnippets: [
        "race-first original Type and Race Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-type-race:8192:32"',
        "original-race-type-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-original-attribute-race-lizard-lock.test.ts",
      kind: "originalAttributeRace",
      requiredSnippets: [
        "original Attribute and Race Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-attribute-race:1:32"',
        "original-attribute-race-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-original-triple-trait-lizard-locks.test.ts",
      kind: "originalTripleTrait",
      requiredSnippets: [
        "original triple trait Lizard locks",
        'luaTargetDescriptor: "target:not-original-type-attribute-race:8192:32:8192"',
        "crimson-gaia-official-original-type-attribute-race-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-continuous-original-rank-lizard-lock.test.ts",
      kind: "originalTypeRank",
      requiredSnippets: [
        "continuous original Type and Rank Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-type-rank:8388608:4"',
        "range: [\"monsterZone\"]",
      ],
    },
    {
      file: "test/lua-real-script-continuous-positive-original-type-lizard-lock.test.ts",
      kind: "positiveOriginalType",
      requiredSnippets: [
        "continuous positive original Type Clock Lizard lock",
        'luaTargetDescriptor: "target:original-type:67108864"',
        "reset: { flags: 0x3fe1000 }",
        "continuous-positive-original-type-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-continuous-positive-original-setcode-lizard-lock.test.ts",
      kind: "positiveOriginalSetcode",
      requiredSnippets: [
        "continuous positive original setcode Clock Lizard lock",
        'luaTargetDescriptor: `target:original-setcode:${setAesir}`',
        "reset: { flags: 0x1fe1000 }",
        "continuous-positive-original-setcode-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-icejade-ran-continuous-lizard-lock.test.ts",
      kind: "currentAttribute",
      requiredSnippets: [
        "Icejade Ran Aegirine continuous Clock Lizard lock",
        'luaTargetDescriptor: "target:not-attribute:2"',
        "reset: { flags: 0x1fe1000 }",
        "icejade-ran-official-continuous-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-scatter-fusion-lizard-setcode-lock.test.ts",
      kind: "currentSetcode",
      requiredSnippets: [
        "Scatter Fusion Clock Lizard setcode lock",
        'luaTargetDescriptor: `target:not-setcode:${setGemKnight}`',
        "scatter-fusion-official-current-setcode-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-sunvine-shrine-continuous-lizard-lock.test.ts",
      kind: "originalRace",
      requiredSnippets: [
        "Sunvine Shrine continuous Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-race:1024"',
        "range: [\"spellTrapZone\"]",
      ],
    },
    {
      file: "test/lua-real-script-wildwind-lizard-original-synchro-lock.test.ts",
      kind: "originalType",
      requiredSnippets: [
        "Wildwind Lizard original Synchro lock",
        'luaTargetDescriptor: "target:not-original-type:8192"',
        "wildwind-official-lizard-check.lua",
      ],
    },
    {
      file: "test/lua-real-script-original-trait-or-lizard-lock.test.ts",
      kind: "originalTypeAttribute",
      requiredSnippets: [
        "original trait OR Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-type-attribute:8192:2"',
        "original-trait-or-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-original-trait-lizard-locks.test.ts",
      kind: "mixedOriginalTraitDescriptors",
      requiredSnippets: [
        "original trait Lizard locks",
        'luaTargetDescriptor: "target:not-original-race:8192"',
        'luaTargetDescriptor: "target:not-original-type-attribute:8192:32"',
        'luaTargetDescriptor: "target:not-original-type-race:8388608:32"',
        "blue-eyes-roar-official-lizard-race.lua",
      ],
    },
    {
      file: "test/lua-real-script-orichalcos-field-lizard-lock.test.ts",
      kind: "descriptorlessFieldLock",
      requireFalse: false,
      requiredSnippets: [
        "Seal of Orichalcos Field Zone Clock Lizard lock",
        "expect(restoredEffect?.luaTargetDescriptor).toBeUndefined()",
        "targetRange: [0xff, 0]",
      ],
    },
    {
      file: "test/lua-real-script-white-knight-continuous-true-lizard.test.ts",
      kind: "descriptorlessFieldLock",
      requireFalse: false,
      requiredSnippets: [
        "White Knight continuous all-card Clock Lizard lock",
        "expect(restoredEffect?.luaTargetDescriptor).toBeUndefined()",
        "White Knight Extra Probe",
      ],
    },
  ];
}

function allCardLizardFixtures(): Array<{
  file: string;
  kind: LizardAllCardKind;
  requiredSnippets: string[];
}> {
  return [
    {
      file: "test/lua-real-script-repair-genex-controller-lizard-true-lock.test.ts",
      kind: "allCardAuxTrue",
      requiredSnippets: [
        "Repair Genex Controller aux.TRUE Clock Lizard lock",
        "aux.addTempLizardCheck(c,0,aux.TRUE)",
        "repair-genex-controller-official-true-lizard.lua",
        "value: 1",
      ],
    },
  ];
}

function lizardSemanticVariants(): Array<{
  file: string;
  kind: LizardSemanticVariant;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-amorphage-goliath-continuous-lizard-lock.test.ts",
      kind: "amorphageGoliathAllLocationOriginalSetcodeLock",
      requiredSnippets: [
        'const goliathCode = "69072185"',
        "restores its all-location original Amorphage Clock Lizard check",
        'luaTargetDescriptor: `target:not-original-setcode:${setAmorphage}`',
      ],
    },
    {
      file: "test/lua-real-script-amorphage-sloth-target-range-lizard-lock.test.ts",
      kind: "amorphageSlothBothPlayerOriginalSetcodeLock",
      requiredSnippets: [
        'const slothCode = "32687071"',
        "restores its both-player 0xff original Amorphage Clock Lizard check",
        "targetRange: [0xff, 0xff]",
      ],
    },
    {
      file: "test/lua-real-script-continuous-original-rank-lizard-lock.test.ts",
      kind: "continuousOriginalRankXyzLock",
      requiredSnippets: [
        'const palmCode = "61116514"',
        "restores Palm Ryzeal's continuous original Rank 4 Xyz Clock Lizard check",
        'luaTargetDescriptor: "target:not-original-type-rank:8388608:4"',
      ],
    },
    {
      file: "test/lua-real-script-continuous-positive-original-setcode-lizard-lock.test.ts",
      kind: "continuousPositiveOriginalSetcodeLock",
      requiredSnippets: [
        'const sourceCode = "7320132"',
        "restores original Aesir continuous Clock Lizard checks",
        'luaTargetDescriptor: `target:original-setcode:${setAesir}`',
      ],
    },
    {
      file: "test/lua-real-script-continuous-positive-original-type-lizard-lock.test.ts",
      kind: "continuousPositiveOriginalTypeLock",
      requiredSnippets: [
        'const sourceCode = "86993168"',
        "restores original Link continuous Clock Lizard checks",
        'luaTargetDescriptor: "target:original-type:67108864"',
      ],
    },
    {
      file: "test/lua-real-script-icejade-ran-continuous-lizard-lock.test.ts",
      kind: "icejadeRanCurrentAttributeLock",
      requiredSnippets: [
        'const icejadeCode = "18494511"',
        "restores its continuous non-WATER Clock Lizard check",
        'luaTargetDescriptor: "target:not-attribute:2"',
      ],
    },
    {
      file: "test/lua-real-script-original-trait-lizard-locks.test.ts",
      kind: "mixedOriginalTraitDescriptorLocks",
      requiredSnippets: [
        'const roarCode = "17725109"',
        "restores Blue-Eyes Roar's original Dragon Clock Lizard check",
        'luaTargetDescriptor: "target:not-original-race:8192"',
      ],
    },
    {
      file: "test/lua-real-script-original-attribute-race-lizard-lock.test.ts",
      kind: "originalAttributeRaceLock",
      requiredSnippets: [
        'const sourceCode = "49296203"',
        "restores original EARTH Machine Clock Lizard checks",
        'luaTargetDescriptor: "target:not-original-attribute-race:1:32"',
      ],
    },
    {
      file: "test/lua-real-script-original-attribute-type-lizard-lock.test.ts",
      kind: "originalAttributeTypeLock",
      requiredSnippets: [
        'const sourceCode = "19434243"',
        "restores original DARK Synchro Clock Lizard checks",
        'luaTargetDescriptor: "target:not-original-type-attribute:8192:32"',
      ],
    },
    {
      file: "test/lua-real-script-original-race-type-lizard-lock.test.ts",
      kind: "originalRaceTypeLock",
      requiredSnippets: [
        'const sourceCode = "55326322"',
        "restores original Machine Synchro Clock Lizard checks",
        'luaTargetDescriptor: "target:not-original-type-race:8192:32"',
      ],
    },
    {
      file: "test/lua-real-script-original-trait-or-lizard-lock.test.ts",
      kind: "originalTraitOrLock",
      requiredSnippets: [
        'const sourceCode = "9396662"',
        "restores equivalent not-type-or-not-attribute original trait checks",
        'luaTargetDescriptor: "target:not-original-type-attribute:8192:2"',
      ],
    },
    {
      file: "test/lua-real-script-original-triple-trait-lizard-locks.test.ts",
      kind: "originalTripleTraitLock",
      requiredSnippets: [
        'const gaiaCode = "66141736"',
        "restores Crimson Gaia's original DARK Dragon Synchro Clock Lizard check",
        'luaTargetDescriptor: "target:not-original-type-attribute-race:8192:32:8192"',
      ],
    },
    {
      file: "test/lua-real-script-orichalcos-field-lizard-lock.test.ts",
      kind: "orichalcosDescriptorlessFieldLock",
      requiredSnippets: [
        'const orichalcosCode = "48179391"',
        "restores its default Field Zone Clock Lizard check",
        "expect(restoredEffect?.luaTargetDescriptor).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-repair-genex-controller-lizard-true-lock.test.ts",
      kind: "repairGenexAllCardAuxTrueLock",
      requiredSnippets: [
        'const repairGenexCode = "8173184"',
        "restores its all-card Clock Lizard check",
        "aux.addTempLizardCheck(c,0,aux.TRUE)",
      ],
    },
    {
      file: "test/lua-real-script-scatter-fusion-lizard-setcode-lock.test.ts",
      kind: "scatterFusionCurrentSetcodeLock",
      requiredSnippets: [
        'const scatterFusionCode = "40597694"',
        "restores its current Gem-Knight Clock Lizard check",
        'luaTargetDescriptor: `target:not-setcode:${setGemKnight}`',
      ],
    },
    {
      file: "test/lua-real-script-single-arg-lizard-lock.test.ts",
      kind: "singleArgOriginalTypeLock",
      requiredSnippets: [
        'const sourceCode = "7375867"',
        "restores original Fusion checks declared with one target parameter",
        'luaTargetDescriptor: "target:not-original-type:64"',
      ],
    },
    {
      file: "test/lua-real-script-sunvine-shrine-continuous-lizard-lock.test.ts",
      kind: "sunvineShrineOriginalRaceLock",
      requiredSnippets: [
        'const shrineCode = "27946124"',
        "restores its Spell/Trap Zone original Plant Clock Lizard check",
        'luaTargetDescriptor: "target:not-original-race:1024"',
      ],
    },
    {
      file: "test/lua-real-script-white-knight-continuous-true-lizard.test.ts",
      kind: "whiteKnightDescriptorlessContinuousLock",
      requiredSnippets: [
        'const whiteKnightCode = "40352445"',
        "restores its default continuous Clock Lizard check",
        "expect(restoredEffect?.luaTargetDescriptor).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-wildwind-lizard-original-synchro-lock.test.ts",
      kind: "wildwindOriginalSynchroLock",
      requiredSnippets: [
        'const wildwindCode = "52589809"',
        "restores its original-type Clock Lizard check",
        'luaTargetDescriptor: "target:not-original-type:8192"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: LizardSemanticVariant;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countLizardDescriptorKinds(
  fixtures: Array<{ kind: LizardDescriptorKind }>,
): Record<LizardDescriptorKind, number> {
  return fixtures.reduce<Record<LizardDescriptorKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      currentAttribute: 0,
      currentSetcode: 0,
      descriptorlessFieldLock: 0,
      mixedOriginalTraitDescriptors: 0,
      notOriginalSetcodeTargetRange: 0,
      originalAttributeRace: 0,
      originalRace: 0,
      originalTripleTrait: 0,
      originalType: 0,
      originalTypeAttribute: 0,
      originalTypeRace: 0,
      originalTypeRank: 0,
      positiveOriginalSetcode: 0,
      positiveOriginalType: 0,
    },
  );
}

function countLizardAllCardKinds(fixtures: Array<{ kind: LizardAllCardKind }>): Record<LizardAllCardKind, number> {
  return fixtures.reduce<Record<LizardAllCardKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      allCardAuxTrue: 0,
    },
  );
}

function countLizardSemanticVariants(
  fixtures: Array<{ kind: LizardSemanticVariant }>,
): Record<LizardSemanticVariant, number> {
  return fixtures.reduce<Record<LizardSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      amorphageGoliathAllLocationOriginalSetcodeLock: 0,
      amorphageSlothBothPlayerOriginalSetcodeLock: 0,
      continuousOriginalRankXyzLock: 0,
      continuousPositiveOriginalSetcodeLock: 0,
      continuousPositiveOriginalTypeLock: 0,
      icejadeRanCurrentAttributeLock: 0,
      mixedOriginalTraitDescriptorLocks: 0,
      originalAttributeRaceLock: 0,
      originalAttributeTypeLock: 0,
      originalRaceTypeLock: 0,
      originalTraitOrLock: 0,
      originalTripleTraitLock: 0,
      orichalcosDescriptorlessFieldLock: 0,
      repairGenexAllCardAuxTrueLock: 0,
      scatterFusionCurrentSetcodeLock: 0,
      singleArgOriginalTypeLock: 0,
      sunvineShrineOriginalRaceLock: 0,
      whiteKnightDescriptorlessContinuousLock: 0,
      wildwindOriginalSynchroLock: 0,
    },
  );
}
