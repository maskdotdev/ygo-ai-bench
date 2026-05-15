import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const chainResponseFixtureCount = 1;

describe("Lua real chain response restore coverage", () => {
  it("requires chain response fixtures to assert clean restore and restored response outcomes", () => {
    const files = chainResponseFixtureFiles();
    expect(files).toHaveLength(chainResponseFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function chainResponseFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-chain-response.test.ts",
      required: [
        'action.type === "activateEffect" && action.uid === ghostBelle!.uid',
        'action.type === "passChain"',
        "restored.session.state.chain).toHaveLength(0)",
        'location: "graveyard"',
        'location: "deck"',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
