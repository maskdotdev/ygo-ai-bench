import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const DRAW_RECOVER_FIXTURE_COUNT = 3;

describe("Lua real draw and recover restore coverage", () => {
  it("requires draw/recover fixtures to assert clean Lua registry restore and restored event outcomes", () => {
    const files = drawRecoverFixtureFiles();
    expect(files).toHaveLength(DRAW_RECOVER_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("eventHistory")
          || !text.includes("operationInfos")
          || !text.includes('eventName: "cardsDrawn"')
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function drawRecoverFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-naturia-ragweed-event-draw-trigger.test.ts",
      required: [
        'eventName: "cardsDrawn"',
        "targetPlayer: 1",
        "targetParam: 2",
        "category: 0x10000",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
      required: [
        'eventName: "normalSummoned"',
        "targetPlayer: 0",
        "targetParam: 1",
        "category: 0x10000",
        'location: "hand", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-upstart-goblin-draw-recover.test.ts",
      required: [
        "category: 0x10000",
        "category: 0x100000",
        'eventName: "recoveredLifePoints"',
        "players[1].lifePoints).toBe(9000)",
        'location: "graveyard"',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
