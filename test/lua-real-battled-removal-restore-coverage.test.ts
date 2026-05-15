import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const battledRemovalFixtureCount = 5;

describe("Lua real battled-removal restore coverage", () => {
  it("requires battled removal fixtures to assert clean Lua registry restore and restored trigger outcomes", () => {
    const files = battledRemovalFixtureFiles();
    expect(files).toHaveLength(battledRemovalFixtureCount);

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
          || !text.includes("pendingTriggers")
          || !text.includes("eventHistory")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function battledRemovalFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-dd-assailant-battled-remove.test.ts",
      required: [
        'eventName: "afterDamageCalculation"',
        'type === "activateTrigger"',
        'eventName: "banished"',
        'location: "banished", controller: 0',
        'location: "banished", controller: 1',
        "battleDestroyed",
      ],
    },
    {
      file: "test/lua-real-script-divine-knight-ishzark-battled-remove.test.ts",
      required: [
        'eventName: "afterDamageCalculation"',
        'type === "activateTrigger"',
        'eventName: "banished"',
        'location: "banished", controller: 1',
        "deferredBattleDestroyed",
        "battleDestroyed",
      ],
    },
    {
      file: "test/lua-real-script-newdoria-battle-destroyed-target.test.ts",
      required: [
        'eventName: "battleDestroyed"',
        'type === "activateTrigger"',
        'eventName: "destroyed"',
        'location: "graveyard"',
        "reasonCardUid: attacker!.uid",
      ],
    },
    {
      file: "test/lua-real-script-lesser-fiend-battle-destroy-redirect.test.ts",
      required: [
        'eventName: "battleDestroyed"',
        "pendingTriggers).toEqual([])",
        'eventName: "banished"',
        'location: "banished"',
        "code: 204",
        "reason: 0x4000021",
      ],
    },
    {
      file: "test/lua-real-script-yamato-no-kami-battle-destroy-backrow.test.ts",
      required: [
        'eventName: "battleDestroyed"',
        'type === "activateTrigger"',
        'eventName: "destroyed"',
        "operationInfos: [{ category: 0x1",
        'location: "graveyard", controller: 1',
        "specialSummonProcedure",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
