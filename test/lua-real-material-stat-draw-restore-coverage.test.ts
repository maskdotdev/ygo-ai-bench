import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const materialStatDrawFixtureCount = 1;
const materialStatDrawKindCounts = {
  linkMaterialReasonCardStatDraw: 1,
} satisfies Record<MaterialStatDrawKind, number>;

type MaterialStatDrawKind = "linkMaterialReasonCardStatDraw";

describe("Lua real material stat draw restore coverage", () => {
  it("requires material stat/draw fixtures to assert clean restore and restored legal actions", () => {
    const fixtures = materialStatDrawFixtureFiles();
    expect(fixtures).toHaveLength(materialStatDrawFixtureCount);

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

  it("keeps material stat/draw fixture kinds explicit", () => {
    expect(countMaterialStatDrawKinds(materialStatDrawFixtureFiles())).toEqual(materialStatDrawKindCounts);
  });
});

function materialStatDrawFixtureFiles(): Array<{ file: string; kind: MaterialStatDrawKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-swap-cleric-link-material-stat-draw.test.ts",
      kind: "linkMaterialReasonCardStatDraw",
      required: [
        "Swap Cleric Link material stat draw",
        "e1:SetCode(EVENT_BE_MATERIAL)",
        "local sc=e:GetHandler():GetReasonCard()",
        "Duel.SetTargetCard(sc)",
        "EFFECT_REVERSE_UPDATE",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "eventName: \"usedAsMaterial\"",
        "eventName: \"cardsDrawn\"",
        "currentAttack(restoredChain.session.state.cards.find",
      ],
    },
  ];
}

function countMaterialStatDrawKinds(fixtures: Array<{ kind: MaterialStatDrawKind }>): Record<MaterialStatDrawKind, number> {
  return fixtures.reduce<Record<MaterialStatDrawKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    { linkMaterialReasonCardStatDraw: 0 },
  );
}
