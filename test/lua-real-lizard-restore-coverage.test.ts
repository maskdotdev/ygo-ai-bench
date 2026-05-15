import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const LIZARD_DESCRIPTOR_FIXTURE_COUNT = 18;
const LIZARD_ALL_CARD_FIXTURE_COUNT = 1;

describe("Lua real Clock Lizard restore coverage", () => {
  it("requires representative Clock Lizard target descriptor fixtures to assert clean Lua registry restore", () => {
    const fixtures = representativeLizardDescriptorFixtures();
    expect(fixtures).toHaveLength(LIZARD_DESCRIPTOR_FIXTURE_COUNT);

    const missing = fixtures
      .filter(({ file, requireFalse = true, requiredSnippets }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
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
          || !requiredSnippets.every((snippet) => text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires all-card Clock Lizard fixtures to assert clean restore without descriptor predicates", () => {
    const fixtures = allCardLizardFixtures();
    expect(fixtures).toHaveLength(LIZARD_ALL_CARD_FIXTURE_COUNT);

    const missing = fixtures
      .filter(({ file, requiredSnippets }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
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
          || !requiredSnippets.every((snippet) => text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function representativeLizardDescriptorFixtures(): Array<{ file: string; requireFalse?: boolean; requiredSnippets: string[] }> {
  return [
    {
      file: "test/lua-real-script-amorphage-goliath-continuous-lizard-lock.test.ts",
      requiredSnippets: [
        "Amorphage Goliath continuous Clock Lizard lock",
        'luaTargetDescriptor: `target:not-original-setcode:${setAmorphage}`',
        "targetRange: [locationAll, locationAll]",
      ],
    },
    {
      file: "test/lua-real-script-amorphage-sloth-target-range-lizard-lock.test.ts",
      requiredSnippets: [
        "Amorphage Sloth target-range Clock Lizard lock",
        'luaTargetDescriptor: `target:not-original-setcode:${setAmorphage}`',
        "targetRange: [0xff, 0xff]",
      ],
    },
    {
      file: "test/lua-real-script-single-arg-lizard-lock.test.ts",
      requiredSnippets: [
        "single-argument Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-type:64"',
        "single-arg-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-original-attribute-type-lizard-lock.test.ts",
      requiredSnippets: [
        "attribute-first original Type and Attribute Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-type-attribute:8192:32"',
        "original-attribute-type-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-original-race-type-lizard-lock.test.ts",
      requiredSnippets: [
        "race-first original Type and Race Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-type-race:8192:32"',
        "original-race-type-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-original-attribute-race-lizard-lock.test.ts",
      requiredSnippets: [
        "original Attribute and Race Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-attribute-race:1:32"',
        "original-attribute-race-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-original-triple-trait-lizard-locks.test.ts",
      requiredSnippets: [
        "original triple trait Lizard locks",
        'luaTargetDescriptor: "target:not-original-type-attribute-race:8192:32:8192"',
        "crimson-gaia-official-original-type-attribute-race-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-continuous-original-rank-lizard-lock.test.ts",
      requiredSnippets: [
        "continuous original Type and Rank Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-type-rank:8388608:4"',
        "range: [\"monsterZone\"]",
      ],
    },
    {
      file: "test/lua-real-script-continuous-positive-original-type-lizard-lock.test.ts",
      requiredSnippets: [
        "continuous positive original Type Clock Lizard lock",
        'luaTargetDescriptor: "target:original-type:67108864"',
        "continuous-positive-original-type-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-continuous-positive-original-setcode-lizard-lock.test.ts",
      requiredSnippets: [
        "continuous positive original setcode Clock Lizard lock",
        'luaTargetDescriptor: `target:original-setcode:${setAesir}`',
        "continuous-positive-original-setcode-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-icejade-ran-continuous-lizard-lock.test.ts",
      requiredSnippets: [
        "Icejade Ran Aegirine continuous Clock Lizard lock",
        'luaTargetDescriptor: "target:not-attribute:2"',
        "icejade-ran-official-continuous-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-scatter-fusion-lizard-setcode-lock.test.ts",
      requiredSnippets: [
        "Scatter Fusion Clock Lizard setcode lock",
        'luaTargetDescriptor: `target:not-setcode:${setGemKnight}`',
        "scatter-fusion-official-current-setcode-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-sunvine-shrine-continuous-lizard-lock.test.ts",
      requiredSnippets: [
        "Sunvine Shrine continuous Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-race:1024"',
        "range: [\"spellTrapZone\"]",
      ],
    },
    {
      file: "test/lua-real-script-wildwind-lizard-original-synchro-lock.test.ts",
      requiredSnippets: [
        "Wildwind Lizard original Synchro lock",
        'luaTargetDescriptor: "target:not-original-type:8192"',
        "wildwind-official-lizard-check.lua",
      ],
    },
    {
      file: "test/lua-real-script-original-trait-or-lizard-lock.test.ts",
      requiredSnippets: [
        "original trait OR Clock Lizard lock",
        'luaTargetDescriptor: "target:not-original-type-attribute:8192:2"',
        "original-trait-or-official-lizard.lua",
      ],
    },
    {
      file: "test/lua-real-script-original-trait-lizard-locks.test.ts",
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
      requireFalse: false,
      requiredSnippets: [
        "Seal of Orichalcos Field Zone Clock Lizard lock",
        "expect(restoredEffect?.luaTargetDescriptor).toBeUndefined()",
        "targetRange: [0xff, 0]",
      ],
    },
    {
      file: "test/lua-real-script-white-knight-continuous-true-lizard.test.ts",
      requireFalse: false,
      requiredSnippets: [
        "White Knight continuous all-card Clock Lizard lock",
        "expect(restoredEffect?.luaTargetDescriptor).toBeUndefined()",
        "White Knight Extra Probe",
      ],
    },
  ];
}

function allCardLizardFixtures(): Array<{ file: string; requiredSnippets: string[] }> {
  return [
    {
      file: "test/lua-real-script-repair-genex-controller-lizard-true-lock.test.ts",
      requiredSnippets: [
        "Repair Genex Controller aux.TRUE Clock Lizard lock",
        "aux.addTempLizardCheck(c,0,aux.TRUE)",
        "repair-genex-controller-official-true-lizard.lua",
        "value: 1",
      ],
    },
  ];
}
