import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const costGateFixtureCount = 3;

describe("Lua real cost gate restore coverage", () => {
  it("requires summon and action cost fixtures to assert clean Lua registry restore and restored gates", () => {
    const files = costGateFixtureFiles();
    expect(files).toHaveLength(costGateFixtureCount);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function costGateFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-spsummon-cost.test.ts",
      required: [
        "cost:special-summon-type-not:",
        "cost:special-summon-type-is:",
        "kochi blocked false",
        "kochi open true",
        "restoredCost?.({ summonTypeCode: luaSummonTypeSpecial + 181 }",
        "restoredCost?.({ summonTypeCode: luaSummonTypeSpecial + 182 }",
        "summonTypeCode:",
      ],
    },
    {
      file: "test/lua-real-script-summon-set-cost.test.ts",
      required: [
        "restoredBlocked.missingRegistryKeys).toEqual([])",
        "restoredBlocked.missingChainLimitRegistryKeys).toEqual([])",
        "restoredOpen.missingRegistryKeys).toEqual([])",
        "restoredOpen.missingChainLimitRegistryKeys).toEqual([])",
        'type: "normalSummon"',
        'type: "setMonster"',
        'type: "setSpellTrap"',
        'type: "activateEffect"',
        "canSpecialSummonDuelCard(restoredBlocked.session.state",
        "canSpecialSummonDuelCard(restoredOpen.session.state",
        "lifePoints).toBe(1)",
      ],
    },
    {
      file: "test/lua-real-script-dogmatikalamity-extra-ritual-lock.test.ts",
      required: [
        "restored.missingRegistryKeys).toEqual([])",
        "restored.missingChainLimitRegistryKeys).toEqual([])",
        'luaTargetDescriptor: "special-summon-limit:extra"',
        "canSpecialSummonDuelCard(session.state, pendulumExtra!.uid, 0)).toBe(true)",
        "canSpecialSummonDuelCard(restored.session.state, pendulumExtra!.uid, 0)).toBe(false)",
        "canSpecialSummonDuelCard(restored.session.state, pendulumExtra!.uid, 0)).toBe(true)",
        'summonType: "ritual"',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
