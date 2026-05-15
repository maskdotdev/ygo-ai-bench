import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const continuousOperationFixtureCount = 3;

describe("Lua real continuous operation restore coverage", () => {
  it("requires continuous operation fixtures to assert clean restore and restored outcomes", () => {
    const files = continuousOperationFixtureFiles();
    expect(files).toHaveLength(continuousOperationFixtureCount);

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
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function continuousOperationFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-core-of-chaos-faceup-redirect.test.ts",
      required: [
        "condition:source-faceup",
        "code: 60",
        "duelReason.effect | duelReason.redirect",
        'location: "banished"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-dark-magician-destruction-original-code-lock.test.ts",
      required: [
        "target:summon-type-code-any:original:",
        "restored original/current",
        "dark magician fusion special 0",
        "dark magician alternate special 0",
        "other fusion special 1",
      ],
    },
    {
      file: "test/lua-real-script-fenghuang-set-backrow-destroy.test.ts",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "operationInfos: [{ category: 0x1",
        'eventName: "destroyed"',
        "host.messages).not.toContain",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
