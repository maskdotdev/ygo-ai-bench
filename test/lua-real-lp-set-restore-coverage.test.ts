import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const LP_SET_FIXTURE_COUNT = 2;
const lpSetKindCounts = {
  pairedSetLpDraw: 1,
  scaleLossSetLp: 1,
} satisfies Record<LpSetKind, number>;
const lpSetSemanticVariantCounts = {
  selfDestructButtonGetLpConditionSetBothToZero: 1,
  pendulumScaleLossAfterCoinDestroy: 1,
} satisfies Record<LpSetSemanticVariant, number>;

type LpSetKind = "pairedSetLpDraw" | "scaleLossSetLp";
type LpSetSemanticVariant = "selfDestructButtonGetLpConditionSetBothToZero" | "pendulumScaleLossAfterCoinDestroy";

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
    {
      file: "test/lua-real-script-tempura-fortune-ebi-pzone-coin.test.ts",
      kind: "scaleLossSetLp",
      required: [
        "restores targeted PZone TossCoin into self-destruction and scale LP loss",
        "Duel.GetLP(tp)-tc:GetScale()*300",
        "players[0].lifePoints).toBe(5600)",
        "lastCoinResults).toEqual([0])",
        'location: "extraDeck"',
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
    {
      file: "test/lua-real-script-tempura-fortune-ebi-pzone-coin.test.ts",
      kind: "pendulumScaleLossAfterCoinDestroy",
      required: [
        "restores targeted PZone TossCoin into self-destruction and scale LP loss",
        "Duel.Destroy(tc,REASON_EFFECT)",
        "Duel.SetLP(tp,Duel.GetLP(tp)-tc:GetScale()*300)",
        "players[0].lifePoints).toBe(5600)",
      ],
    },
  ];
}

function countLpSetKinds(fixtures: Array<{ kind: LpSetKind }>): Record<LpSetKind, number> {
  return fixtures.reduce<Record<LpSetKind, number>>(
    (counts, fixture) => ({ ...counts, [fixture.kind]: counts[fixture.kind] + 1 }),
    { pairedSetLpDraw: 0, scaleLossSetLp: 0 },
  );
}

function countLpSetSemanticVariants(fixtures: Array<{ kind: LpSetSemanticVariant }>): Record<LpSetSemanticVariant, number> {
  return fixtures.reduce<Record<LpSetSemanticVariant, number>>(
    (counts, fixture) => ({ ...counts, [fixture.kind]: counts[fixture.kind] + 1 }),
    { selfDestructButtonGetLpConditionSetBothToZero: 0, pendulumScaleLossAfterCoinDestroy: 0 },
  );
}
