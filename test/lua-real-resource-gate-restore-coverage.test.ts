import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const resourceGateFixtureCount = 3;

describe("Lua real resource gate restore coverage", () => {
  it("requires resource gate fixtures to assert clean restore and restored blocked/allowed outcomes", () => {
    const files = resourceGateFixtureFiles();
    expect(files).toHaveLength(resourceGateFixtureCount);

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

function resourceGateFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-diabolos-effect-release-lock.test.ts",
      required: [
        "costRestored.missingRegistryKeys).toEqual([])",
        "diabolos release predicates true/false/true",
        "diabolos effect release 1",
        "diabolos cost release 1",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-protector-sanctuary-cannot-draw.test.ts",
      required: [
        "code: 25",
        "protector can draw main1 false",
        "protector draw main1 0/0",
        "protector can draw draw phase true",
        "protector draw draw phase 1/1",
      ],
    },
    {
      file: "test/lua-real-script-rikka-konkon-extra-release-cost.test.ts",
      required: [
        "code: 158",
        "code: Number(konkonCode)",
        "getLuaRestoreLegalActionGroups",
        "duelReason.release | duelReason.cost",
        'position: "faceUpDefense"',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
