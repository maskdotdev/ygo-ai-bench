import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real activity restore coverage", () => {
  it("requires representative activity fixtures to assert clean Lua restore", () => {
    const missing = realScriptActivityFixtureFiles()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("getLuaRestoreLegalActions");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires representative activity fixtures to prove restored activity counters and delayed operations", () => {
    const missing = realScriptActivityFixtureFiles()
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("activityHistory")
          || !text.includes("duelActivity.chain")
          || !text.includes("effectId?.startsWith(\"lua-\")")
          || requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptActivityFixtureFiles(): Array<{ file: string; requiredSnippets: string[] }> {
  return [
    {
      file: "test/lua-real-script-mulcharmy-activity.test.ts",
      requiredSnippets: [
        "Mulcharmy activity counters",
        "toHaveLength(1)",
        "toHaveLength(2)",
        "getLuaRestoreLegalActions(restoredAfterPurulia, 0).some",
        "chain summoner hand after summon 0",
        'location: "hand", controller: 0',
      ],
    },
  ];
}
