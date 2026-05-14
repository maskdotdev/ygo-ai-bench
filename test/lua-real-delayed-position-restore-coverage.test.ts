import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real delayed position restore coverage", () => {
  it("requires delayed position fixtures to assert clean restore and restored delayed outcomes", () => {
    const missing = delayedPositionFixtureFiles()
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

function delayedPositionFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-book-eclipse-delayed-flip-draw.test.ts",
      required: [
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredEnd.missingRegistryKeys).toEqual([])",
        "operationInfos: [",
        "position: \"faceDownDefense\"",
        "position: \"faceUpDefense\"",
        'action.type === "changePhase"',
        'location: "hand", controller: 1',
        "host.messages).not.toContain",
      ],
    },
  ];
}
