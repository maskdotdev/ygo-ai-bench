import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const costGateFixtureCount = 2;

describe("Lua real cost gate restore coverage", () => {
  it("requires summon and action cost fixtures to assert clean Lua registry restore and restored gates", () => {
    const files = costGateFixtureFiles();
    expect(files).toHaveLength(costGateFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || required.some((snippet) => !text.includes(snippet));
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
        "summonTypeCode:",
      ],
    },
    {
      file: "test/lua-real-script-summon-set-cost.test.ts",
      required: [
        "restoredBlocked.missingRegistryKeys).toEqual([])",
        "restoredOpen.missingRegistryKeys).toEqual([])",
        'type: "normalSummon"',
        'type: "setMonster"',
        'type: "setSpellTrap"',
        'type: "activateEffect"',
        "canSpecialSummonDuelCard(restoredBlocked.session.state",
        "canSpecialSummonDuelCard(restoredOpen.session.state",
        "lifePoints).toBe(1)",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
