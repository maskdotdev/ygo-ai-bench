import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const attackRestrictionFixtureCount = 4;

describe("Lua real attack-restriction restore coverage", () => {
  it("requires representative field, player, and remain-field attack locks to assert clean Lua restore", () => {
    const files = realScriptAttackRestrictionFixtureFiles();
    expect(files).toHaveLength(attackRestrictionFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("CanAttack")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptAttackRestrictionFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-gravity-bind-persistent-attack-lock.test.ts",
      required: [
        "gravity bind attack true/false",
        "highAttacker!.uid)).toBe(false)",
        "faceUp: true",
      ],
    },
    {
      file: "test/lua-real-script-messenger-peace-maintenance-attack-lock.test.ts",
      required: [
        "messenger of peace attack true/false",
        "lifePointCostPaid",
        "eventValue: 100",
      ],
    },
    {
      file: "test/lua-real-script-swords-revealing-light-remain-lock.test.ts",
      required: [
        "swords of revealing light state false/true/4",
        "turnCounter: 3",
        "position: \"faceUpDefense\"",
      ],
    },
    {
      file: "test/lua-real-script-threatening-roar-temporary-attack-lock.test.ts",
      required: [
        "code: 86",
        "targetRange: [0, 1]",
        "threatening roar attack false",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
