import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const activityKindCounts = {
  mulcharmyChainSummonCounters: 1,
} satisfies Record<ActivityKind, number>;
const activitySemanticVariantCounts = {
  mulcharmySharedChainLimitAndDelayedDraw: 1,
} satisfies Record<ActivitySemanticVariant, number>;

type ActivityKind = "mulcharmyChainSummonCounters";

type ActivitySemanticVariant = "mulcharmySharedChainLimitAndDelayedDraw";

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

  it("keeps activity fixture kinds explicit", () => {
    expect(countActivityKinds(realScriptActivityFixtureFiles())).toEqual(activityKindCounts);
  });

  it("keeps named activity semantic variants explicit", () => {
    expect(countActivitySemanticVariants(activitySemanticVariants())).toEqual(activitySemanticVariantCounts);

    const weak = activitySemanticVariants()
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function realScriptActivityFixtureFiles(): Array<{
  file: string;
  kind: ActivityKind;
  requiredSnippets: string[];
}> {
  return [
    {
      file: "test/lua-real-script-mulcharmy-activity.test.ts",
      kind: "mulcharmyChainSummonCounters",
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

function countActivityKinds(fixtures: Array<{ kind: ActivityKind }>): Record<ActivityKind, number> {
  return fixtures.reduce<Record<ActivityKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      mulcharmyChainSummonCounters: 0,
    },
  );
}

function activitySemanticVariants(): Array<{
  file: string;
  kind: ActivitySemanticVariant;
  requiredSnippets: string[];
}> {
  return [
    {
      file: "test/lua-real-script-mulcharmy-activity.test.ts",
      kind: "mulcharmySharedChainLimitAndDelayedDraw",
      requiredSnippets: [
        'const fuwalosCode = "42141493"',
        'const puruliaCode = "84192580"',
        'const meowlsCode = "87126721"',
        "counts real Mulcharmy monster effect chain activations for the shared two-activation limit",
        "delays restored Mulcharmy chain-solving draws until the current chain link is solved",
        "record.activity === duelActivity.chain",
        "effectId?.startsWith(\"lua-\")",
        "action.type === \"activateEffect\" && action.uid === meowls?.uid)).toBe(false)",
        "chain summoner hand after summon 0",
      ],
    },
  ];
}

function countActivitySemanticVariants(fixtures: Array<{ kind: ActivitySemanticVariant }>): Record<ActivitySemanticVariant, number> {
  return fixtures.reduce<Record<ActivitySemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      mulcharmySharedChainLimitAndDelayedDraw: 0,
    },
  );
}
