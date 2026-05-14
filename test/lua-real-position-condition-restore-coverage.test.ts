import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real position condition restore coverage", () => {
  it("requires position predicate fixtures to assert clean Lua registry restore and restored predicates", () => {
    const missing = positionConditionFixtureFiles()
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

function positionConditionFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-checksum-dragon-position-indestructible.test.ts",
      required: [
        "condition:source-attack-position",
        "condition:source-defense-position",
        "restoredEffect!.canActivate!(ctx)",
        "destroyDuelCard(restored.session.state",
        "duelReason.battle | duelReason.destroy",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
