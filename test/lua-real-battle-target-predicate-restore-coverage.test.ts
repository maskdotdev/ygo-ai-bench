import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real battle target predicate restore coverage", () => {
  it("requires battle-target predicate fixtures to assert clean Lua registry restore and restored predicates", () => {
    const missing = battleTargetPredicateFixtureFiles()
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
  ].sort((a, b) => a.file.localeCompare(b.file));
}
