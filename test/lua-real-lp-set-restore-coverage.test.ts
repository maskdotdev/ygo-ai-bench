import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const LP_SET_FIXTURE_COUNT = 1;
const lpSetKindCounts = {
  pairedSetLpDraw: 1,
} satisfies Record<LpSetKind, number>;
const lpSetSemanticVariantCounts = {
  selfDestructButtonGetLpConditionSetBothToZero: 1,
} satisfies Record<LpSetSemanticVariant, number>;

type LpSetKind = "pairedSetLpDraw";
type LpSetSemanticVariant = "selfDestructButtonGetLpConditionSetBothToZero";

describe("Lua real LP SetLP restore coverage", () => {
  it("requires LP SetLP fixtures to assert clean Lua registry restore and restored legal actions", () => {
    const files = lpSetFixtureFiles();
    expect(files).toHaveLength(LP_SET_FIXTURE_COUNT);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps LP SetLP fixture kinds explicit", () => {
    expect(countLpSetKinds(lpSetFixtureFiles())).toEqual(lpSetKindCounts);
  });

  it("keeps named LP SetLP semantic variants explicit", () => {
    expect(countLpSetSemanticVariants(lpSetSemanticVariants())).toEqual(lpSetSemanticVariantCounts);

    const weak = lpSetSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function lpSetFixtureFiles(): Array<{ file: string; kind: LpSetKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-self-destruct-button-set-lp-draw.test.ts",
      kind: "pairedSetLpDraw",
      required: [
        "Duel.GetLP(tp)<=Duel.GetLP(1-tp)-7000",
        "Duel.SetLP(tp,0)",
        "Duel.SetLP(1-tp,0)",
        'status).toBe("ended")',
        'winner).toBe("draw")',
        "players[0].lifePoints).toBe(0)",
        "players[1].lifePoints).toBe(0)",
      ],
    },
  ];
}

function lpSetSemanticVariants(): Array<{ file: string; kind: LpSetSemanticVariant; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-self-destruct-button-set-lp-draw.test.ts",
      kind: "selfDestructButtonGetLpConditionSetBothToZero",
      required: [
        "restores GetLP activation condition and defers paired SetLP defeat into a draw",
        "Duel.GetLP(tp)<=Duel.GetLP(1-tp)-7000",
        "Duel.SetLP(1-tp,0)",
        'winner).toBe("draw")',
      ],
    },
  ];
}

function countLpSetKinds(fixtures: Array<{ kind: LpSetKind }>): Record<LpSetKind, number> {
  return fixtures.reduce<Record<LpSetKind, number>>(
    (counts, fixture) => ({ ...counts, [fixture.kind]: counts[fixture.kind] + 1 }),
    { pairedSetLpDraw: 0 },
  );
}

function countLpSetSemanticVariants(fixtures: Array<{ kind: LpSetSemanticVariant }>): Record<LpSetSemanticVariant, number> {
  return fixtures.reduce<Record<LpSetSemanticVariant, number>>(
    (counts, fixture) => ({ ...counts, [fixture.kind]: counts[fixture.kind] + 1 }),
    { selfDestructButtonGetLpConditionSetBothToZero: 0 },
  );
}
