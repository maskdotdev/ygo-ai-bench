import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real summon-success trap restore coverage", () => {
  it("requires summon-success trap fixtures to assert clean Lua registry restore and restored chain outcomes", () => {
    const missing = summonSuccessTrapFixtureFiles()
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("operationInfos")
          || !text.includes('type === "passChain"')
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function summonSuccessTrapFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-bottomless-trap-hole-summon-success.test.ts",
      required: [
        'eventName: "normalSummoned"',
        'eventName: "specialSummoned"',
        "category: 0x1",
        "category: 0x4",
        'location: "banished"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-torrential-tribute-summon-success.test.ts",
      required: [
        'eventName: "normalSummoned"',
        "assertDestroyOperationInfo",
        "destroyedUids",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-trap-hole-summon-success.test.ts",
      required: [
        'eventName: "normalSummoned"',
        "category: 0x1",
        "targetUids: [summoned!.uid]",
        'location: "graveyard"',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
