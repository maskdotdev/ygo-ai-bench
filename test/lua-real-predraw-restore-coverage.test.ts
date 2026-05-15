import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const PREDRAW_FIXTURE_COUNT = 2;

describe("Lua real predraw restore coverage", () => {
  it("requires representative predraw delayed-effect fixtures to assert clean Lua restore", () => {
    const files = realScriptPredrawFixtureFiles();
    expect(files).toHaveLength(PREDRAW_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("applyLuaRestoreResponse")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptPredrawFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-hino-kagu-tsuchi-predraw-discard.test.ts",
      required: [
        'eventName: "battleDamageDealt"',
        "code: 1113",
        'eventName: "preDraw"',
        'eventName: "discarded"',
      ],
    },
    {
      file: "test/lua-real-script-maharaghi-predraw.test.ts",
      required: [
        'action.type === "normalSummon"',
        'action.type === "activateTrigger"',
        "code: 1113",
        'eventName: "confirmed"',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
