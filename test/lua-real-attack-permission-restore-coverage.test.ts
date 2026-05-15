import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const attackPermissionFixtureCount = 5;

describe("Lua real attack-permission restore coverage", () => {
  it("requires representative attack permission and cost fixtures to assert clean Lua restore", () => {
    const files = realScriptAttackPermissionFixtureFiles();
    expect(files).toHaveLength(attackPermissionFixtureCount);

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
});

function realScriptAttackPermissionFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-big-tusked-mammoth-summon-turn-attack-lock.test.ts",
      required: [
        "code: 85",
        "hasAttack(actions, freshAttacker.uid, mammoth.uid)).toBe(false)",
        "big tusked mammoth can attack false/true",
      ],
    },
    {
      file: "test/lua-real-script-dark-elf-attack-cost.test.ts",
      required: [
        "code: 96",
        "attackCostPaid).toBe(1)",
        "lifePointCostPaid",
      ],
    },
    {
      file: "test/lua-real-script-misfortune-cannot-attack-lock.test.ts",
      required: [
        "code === 85",
        "targetRange: [0x04, 0]",
        "misfortune attacker can attack false",
      ],
    },
    {
      file: "test/lua-real-script-true-sun-god-special-summon-attack-lock.test.ts",
      required: [
        "code: 85",
        "hasAttack(actions, specialAttacker.uid, target.uid)).toBe(false)",
        "true sun god can attack false/true",
      ],
    },
    {
      file: "test/lua-real-script-ultimate-tyranno-attack-lock.test.ts",
      required: [
        "code: 85",
        "code: 193",
        "ultimate tyranno can attack true/false",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
