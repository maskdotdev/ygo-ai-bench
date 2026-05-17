import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const PREDRAW_FIXTURE_COUNT = 2;
const predrawKindCounts = {
  battleDamagePredrawDiscard: 1,
  spiritPredrawConfirm: 1,
} satisfies Record<PredrawKind, number>;

type PredrawKind = "battleDamagePredrawDiscard" | "spiritPredrawConfirm";

describe("Lua real predraw restore coverage", () => {
  it("requires representative predraw delayed-effect fixtures to assert clean Lua restore", () => {
    const files = realScriptPredrawFixtureFiles();
    expect(files).toHaveLength(PREDRAW_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("applyLuaRestoreResponse")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps predraw fixture kinds explicit", () => {
    expect(countPredrawKinds(realScriptPredrawFixtureFiles())).toEqual(predrawKindCounts);
  });
});

function realScriptPredrawFixtureFiles(): Array<{
  file: string;
  kind: PredrawKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-hino-kagu-tsuchi-predraw-discard.test.ts",
      kind: "battleDamagePredrawDiscard",
      required: [
        'eventName: "battleDamageDealt"',
        "code: 1113",
        'eventName: "preDraw"',
        'eventName: "discarded"',
      ],
    },
    {
      file: "test/lua-real-script-maharaghi-predraw.test.ts",
      kind: "spiritPredrawConfirm",
      required: [
        'action.type === "normalSummon"',
        'action.type === "activateTrigger"',
        "code: 1113",
        'eventName: "confirmed"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PredrawKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPredrawKinds(fixtures: Array<{ kind: PredrawKind }>): Record<PredrawKind, number> {
  return fixtures.reduce<Record<PredrawKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      battleDamagePredrawDiscard: 0,
      spiritPredrawConfirm: 0,
    },
  );
}
