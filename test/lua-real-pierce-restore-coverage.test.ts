import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const PIERCING_FIXTURE_COUNT = 2;

describe("Lua real piercing damage restore coverage", () => {
  it("requires piercing damage fixtures to assert clean Lua registry restore and restored damage semantics", () => {
    const files = piercingFixtureFiles();
    expect(files).toHaveLength(PIERCING_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("battleDamage")
          || !text.includes("lifePoints")
          || !text.includes('eventName: "battleDamageDealt"')
          || !text.includes("eventHistory")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function piercingFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-enraged-battle-ox-pierce.test.ts",
      required: [
        "code: 203",
        "targetRange: [4, 0]",
        "battleDamage[1]).toBe(700)",
        "players[1].lifePoints).toBe(7300)",
        "battleDamage[1]).toBe(0)",
      ],
    },
    {
      file: "test/lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
      required: [
        "operationInfos: [{ category: 0x40000",
        "equippedToUid: equippedAttacker!.uid",
        "battleDamage).toEqual({ 0: 0, 1: 800 })",
        "players[1].lifePoints).toBe(7200)",
        "not.toEqual(",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
