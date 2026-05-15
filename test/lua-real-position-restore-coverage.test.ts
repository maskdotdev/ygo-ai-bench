import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const POSITION_FIXTURE_COUNT = 4;

describe("Lua real position restore coverage", () => {
  it("requires position-changing summon triggers to assert clean Lua registry restore and restored outcomes", () => {
    const files = positionFixtureFiles();
    expect(files).toHaveLength(POSITION_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("eventHistory")
          || !text.includes('eventName: "positionChanged"')
          || !text.includes("host.messages).not.toContain")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function positionFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-angineer-overlay-position.test.ts",
      required: [
        "targetUids: [target!.uid]",
        'eventName: "detachedMaterial"',
        "positionsChanged).toEqual([target!.uid])",
        "overlayUids: []",
      ],
    },
    {
      file: "test/lua-real-script-gagaga-escape-position-lockout.test.ts",
      required: [
        "category: 0x1000",
        "positionsChanged).toEqual([changed!.uid, eligible!.uid])",
        'eventName: "banished"',
        'position: "faceUpDefense", faceUp: true',
      ],
    },
    {
      file: "test/lua-real-script-otohime-position-overload.test.ts",
      required: [
        "operationInfos: [{ category: 0x1000",
        "parameter: 0",
        'position: "faceUpAttack", faceUp: true',
      ],
    },
    {
      file: "test/lua-real-script-tsukuyomi-position-trigger.test.ts",
      required: [
        "operationInfos: [{ category: 0x1000",
        "parameter: 0x8",
        'position: "faceDownDefense", faceUp: false',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
