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
