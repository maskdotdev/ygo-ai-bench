import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const chainResponseFixtureCount = 2;

describe("Lua real chain response restore coverage", () => {
  it("requires chain response fixtures to assert clean restore and restored response outcomes", () => {
    const files = chainResponseFixtureFiles();
    expect(files).toHaveLength(chainResponseFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
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

function chainResponseFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-chain-response.test.ts",
      required: [
        'action.type === "activateEffect" && action.uid === ghostBelle!.uid',
        'action.type === "passChain"',
        "restored.session.state.chain).toHaveLength(0)",
        'location: "graveyard"',
        'location: "deck"',
      ],
    },
    {
      file: "test/lua-real-script-wiretap-trap-negate-to-deck.test.ts",
      required: [
        'action.type === "activateEffect" && action.uid === wiretap!.uid',
        'action.type === "passChain"',
        "restoredPendingResolution.session.state.chain).toHaveLength(0)",
        'location: "graveyard"',
        'location: "deck"',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
