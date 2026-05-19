import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const gaiaFixtureCount = 1;
const gaiaBehaviorKindCounts = {
  releaseCostSearchHandDiscard: 1,
  spElimBanishCostTargetAttackBoost: 1,
} satisfies Record<GaiaBehaviorKind, number>;

type GaiaBehaviorKind = "releaseCostSearchHandDiscard" | "spElimBanishCostTargetAttackBoost";

describe("Lua real Gaia restore coverage", () => {
  it("requires Gaia fixtures to assert clean Lua registry restore and restored legal-action parity", () => {
    const files = gaiaFixtureFiles();
    expect(files).toHaveLength(gaiaFixtureCount);

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

  it("keeps Gaia behavior variants explicit", () => {
    expect(countGaiaBehaviorKinds(gaiaBehaviorFixtures())).toEqual(gaiaBehaviorKindCounts);

    const weak = gaiaBehaviorFixtures()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function gaiaFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-gaia-polar-knight-search-discard-atk.test.ts",
      required: [
        "Gaia, the Polar Knight search discard and ATK boost",
        'const gaiaCode = "14882493"',
        "eventHistory",
        "operationInfos",
        "host.messages).not.toContain",
      ],
    },
  ];
}

function gaiaBehaviorFixtures(): Array<{ file: string; kind: GaiaBehaviorKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-gaia-polar-knight-search-discard-atk.test.ts",
      kind: "releaseCostSearchHandDiscard",
      required: [
        "restores its DARK release-cost LIGHT Warrior search and follow-up hand discard",
        "Duel.CheckReleaseGroupCost(tp,Card.IsAttribute,1,false,nil,e:GetHandler(),ATTRIBUTE_DARK)",
        "Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,1,tp,1)",
        "Duel.DiscardHand(tp,nil,1,1,REASON_EFFECT)",
        "{ category: 0x80, targetUids: [], count: 1, player: 0, parameter: 1 }",
        'eventName: "released"',
        'eventName: "sentToGraveyard"',
      ],
    },
    {
      file: "test/lua-real-script-gaia-polar-knight-search-discard-atk.test.ts",
      kind: "spElimBanishCostTargetAttackBoost",
      required: [
        "restores its LIGHT aux.SpElimFilter banish cost into a targeted two-turn ATK boost",
        "aux.SpElimFilter(c,true)",
        "Duel.Remove(g,POS_FACEUP,REASON_COST)",
        "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)",
        "e1:SetCode(EFFECT_UPDATE_ATTACK)",
        "value: 500",
        "reset: { flags: 0x41fe1200, count: 2 }",
      ],
    },
  ];
}

function countGaiaBehaviorKinds(fixtures: Array<{ kind: GaiaBehaviorKind }>): Record<GaiaBehaviorKind, number> {
  return fixtures.reduce<Record<GaiaBehaviorKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      releaseCostSearchHandDiscard: 0,
      spElimBanishCostTargetAttackBoost: 0,
    },
  );
}
