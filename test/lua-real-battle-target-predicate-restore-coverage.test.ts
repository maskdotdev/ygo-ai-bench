import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battleTargetPredicateFixtureCount = 2;

describe("Lua real battle target predicate restore coverage", () => {
  it("requires battle-target predicate fixtures to assert clean Lua registry restore and restored predicates", () => {
    const files = battleTargetPredicateFixtureFiles();
    expect(files).toHaveLength(battleTargetPredicateFixtureCount);

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

function battleTargetPredicateFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-battle-target-predicates.test.ts",
      required: [
        "target:source-battle-target-type:64",
        "target:source-or-battle-target",
        "target:source-battle-target",
        "currentAttack = { attackerUid:",
        "targetCardPredicate",
      ],
    },
    {
      file: "test/lua-real-script-hunter-owl-wind-target-stat.test.ts",
      required: [
        "hasAttack(actions, attacker.uid, hunterOwl.uid)).toBe(false)",
        "hasAttack(actions, attacker.uid, windAlly.uid)).toBe(true)",
        "hunter owl target/stat protected",
        "valueCardPredicate",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
