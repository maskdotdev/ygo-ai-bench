import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const branchingSpellFixtureCount = 1;
const branchingSpellKindCounts = {
  selectEffectStatOrGraveSet: 1,
} satisfies Record<BranchingSpellKind, number>;

type BranchingSpellKind = "selectEffectStatOrGraveSet";

describe("Lua real branching Spell restore coverage", () => {
  it("requires branching Spell fixtures to assert clean restore and restored legal actions", () => {
    const fixtures = branchingSpellFixtureFiles();
    expect(fixtures).toHaveLength(branchingSpellFixtureCount);

    const missing = fixtures
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

  it("keeps branching Spell fixture kinds explicit", () => {
    expect(countBranchingSpellKinds(branchingSpellFixtureFiles())).toEqual(branchingSpellKindCounts);
  });
});

function branchingSpellFixtureFiles(): Array<{ file: string; kind: BranchingSpellKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-arms-regeneration-stat-grave-set.test.ts",
      kind: "selectEffectStatOrGraveSet",
      required: [
        "Arms Regeneration stat grave set",
        "Duel.SelectEffect(tp,",
        "Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,tc,1,tp,800)",
        "Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,tc,1,tc:GetControler(),0)",
        "Duel.SetPossibleOperationInfo(0,CATEGORY_EQUIP,tc,1,tp,0)",
        "tc:UpdateAttack(800,RESETS_STANDARD_PHASE_END,e:GetHandler())",
        "Duel.SSet(tp,eqpc)",
        "eventName: \"spellTrapSet\"",
        "attackModifier: 800",
      ],
    },
  ];
}

function countBranchingSpellKinds(fixtures: Array<{ kind: BranchingSpellKind }>): Record<BranchingSpellKind, number> {
  return fixtures.reduce<Record<BranchingSpellKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    { selectEffectStatOrGraveSet: 0 },
  );
}
