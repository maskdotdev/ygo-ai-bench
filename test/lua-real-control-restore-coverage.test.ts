import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const controlFixtureCount = 6;

describe("Lua real control restore coverage", () => {
  it("requires representative control-change fixtures to prove clean Lua restore and replayed legal actions", () => {
    const files = realScriptControlFixtureFiles();
    expect(files).toHaveLength(controlFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("previousController")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptControlFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-change-of-heart-control-return.test.ts",
      required: [
        'luaValueDescriptor: "temporary-control-return"',
        'registryKey: `lua:${targetCode}:temporary-control-return:${target!.uid}`',
        "not.toContain(`lua:${targetCode}:temporary-control-return:${target!.uid}`)",
      ],
    },
    {
      file: "lua-real-script-brain-control-cost-return.test.ts",
      required: [
        "lifePointCostPaid",
        "players[0].lifePoints).toBe(7200)",
        'luaValueDescriptor: "temporary-control-return"',
      ],
    },
    {
      file: "lua-real-script-enemy-controller-control-cost.test.ts",
      required: [
        "effectLabel: 2",
        "duelReason.release",
        "duelReason.cost",
        'luaValueDescriptor: "temporary-control-return"',
      ],
    },
    {
      file: "lua-real-script-mind-control-restrictions.test.ts",
      required: [
        "restrictionCodes(restoredResponseWindow.session, target!.uid)).toEqual([43, 44, 85])",
        "mind release probe true/false/0",
        'action.type === "declareAttack"',
      ],
    },
    {
      file: "lua-real-script-creature-swap-control-lock.test.ts",
      required: [
        "targetUids ?? []).toEqual([])",
        "positionLockCodes(restoredResponseWindow.session, ownMonster!.uid)).toEqual([14])",
        "creature swap position probe false/false",
      ],
    },
    {
      file: "lua-real-script-snatch-steal-equip-control.test.ts",
      required: [
        "equippedToUid: target!.uid",
        "previousEquippedToUid: target!.uid",
        "snatch probe 0/45986603/612501",
        "snatch probe 1/nil/nil",
      ],
    },
  ].map(({ file, required }) => ({ file: path.join("test", file), required }));
}
