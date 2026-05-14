import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real delayed relation restore coverage", () => {
  it("requires delayed relation fixtures to assert clean Lua registry restore and restored delayed outcomes", () => {
    const missing = delayedRelationFixtureFiles()
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function delayedRelationFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-kinka-byo-relation-banish.test.ts",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredRelationWindow.missingRegistryKeys).toEqual([])",
        "kinka relation true/true/true",
        'eventName: "specialSummoned"',
        'eventName: "banished"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-sunlit-sentinel-set-destroy-standby.test.ts",
      required: [
        'previousPosition: "faceDown"',
        'triggerEvent: "phaseStandby"',
        'luaConditionDescriptor: "condition:source-turn-next"',
        'type === "activateTrigger"',
        'location: "monsterZone"',
      ],
    },
    {
      file: "test/lua-real-script-yellow-alert-delayed-return.test.ts",
      required: [
        "code: 0x1080",
        "code: 332",
        'type === "changePhase"',
        'phase === "main2"',
        'location: "hand", controller: 1',
        "expectAttackTarget(restored.session",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
