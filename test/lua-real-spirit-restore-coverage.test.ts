import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real Spirit restore coverage", () => {
  it("requires representative Spirit fixtures to prove clean Lua restore and replayed legal actions", () => {
    const missing = realScriptSpiritFixtureFiles()
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getDuelLegalActions")
          || !text.includes("applyLuaRestoreResponse")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptSpiritFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-sakitama-spirit-effect-summon.test.ts",
      required: [
        "restoredOpenWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredReleaseChain.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerChain.missingRegistryKeys).toEqual([])",
        'summonType: "normal"',
        'eventName: "released"',
        'location: "hand", controller: 0',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "lua-real-script-konohanasakuya-spirit-special-return.test.ts",
      required: [
        'action.type === "specialSummonProcedure"',
        'eventName: "phaseEnd"',
        'action.type === "activateTrigger"',
        'location: "hand"',
      ],
    },
    {
      file: "lua-real-script-izanagi-spirit-maynot-return.test.ts",
      required: [
        'action.type === "specialSummonProcedure"',
        'action.type === "declineTrigger"',
        'action.type === "activateTrigger"',
        'location: "banished"',
        'location: "hand"',
      ],
    },
    {
      file: "lua-real-script-nikitama-extra-spirit-summon.test.ts",
      required: [
        "normalSummonAvailable).toBe(false)",
        'action.type === "normalSummon"',
        "overLimit).toBeUndefined()",
      ],
    },
    {
      file: "lua-real-script-aratama-spirit-search.test.ts",
      required: [
        'action.type === "activateTrigger"',
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
      ],
    },
  ].map(({ file, required }) => ({ file: path.join("test", file), required }));
}
