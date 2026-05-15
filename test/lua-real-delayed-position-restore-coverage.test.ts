import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const delayedPositionFixtureCount = 2;

describe("Lua real delayed position restore coverage", () => {
  it("requires delayed position fixtures to assert clean restore and restored delayed outcomes", () => {
    const files = delayedPositionFixtureFiles();
    expect(files).toHaveLength(delayedPositionFixtureCount);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function delayedPositionFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-unleash-your-power-gemini-delayed-set.test.ts",
      required: [
        "restores group-wide Gemini status and delayed End Phase position change",
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredActivation.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredStatus.missingRegistryKeys).toEqual([])",
        "restoredStatus.missingChainLimitRegistryKeys).toEqual([])",
        "restoredAfterEnd.missingRegistryKeys).toEqual([])",
        "restoredAfterEnd.missingChainLimitRegistryKeys).toEqual([])",
        'action.type === "changePhase"',
        "position: \"faceUpAttack\"",
        "position: \"faceUpDefense\"",
        "position: \"faceDownDefense\"",
        'eventName: "positionChanged"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-book-eclipse-delayed-flip-draw.test.ts",
      required: [
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredActivation.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredEnd.missingRegistryKeys).toEqual([])",
        "restoredEnd.missingChainLimitRegistryKeys).toEqual([])",
        "operationInfos: [",
        "position: \"faceDownDefense\"",
        "position: \"faceUpDefense\"",
        'action.type === "changePhase"',
        'location: "hand", controller: 1',
        "host.messages).not.toContain",
      ],
    },
  ];
}
