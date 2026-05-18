import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const searchCostFixtureCount = 1;
const searchCostKindCounts = {
  selfDiscardFirstMatchSearch: 1,
} satisfies Record<SearchCostKind, number>;
const searchCostSemanticVariantCounts = {
  destroyersaurusSelfDiscardJurassicWorldSearch: 1,
} satisfies Record<SearchCostSemanticVariant, number>;

type SearchCostKind = "selfDiscardFirstMatchSearch";
type SearchCostSemanticVariant = "destroyersaurusSelfDiscardJurassicWorldSearch";

describe("Lua real search cost restore coverage", () => {
  it("requires search cost fixtures to assert clean Lua registry restore and restored legal actions", () => {
    const fixtures = searchCostFixtureFiles();
    expect(fixtures).toHaveLength(searchCostFixtureCount);

    const missing = fixtures
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("applyLuaRestoreResponse");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires search cost fixtures to prove cost, operation info, first-match search, and confirmation events", () => {
    const fixtures = searchCostFixtureFiles();
    expect(fixtures).toHaveLength(searchCostFixtureCount);

    const missing = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("operationInfos")
          || !text.includes("category: 0x8")
          || !text.includes('eventName: "sentToGraveyard"')
          || !text.includes('eventName: "sentToHand"')
          || !text.includes('eventName: "sentToHandConfirmed"')
          || !text.includes('location: "graveyard"')
          || !text.includes('location: "hand"')
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps search cost fixture kinds explicit", () => {
    expect(countSearchCostKinds(searchCostFixtureFiles())).toEqual(searchCostKindCounts);
  });

  it("keeps named search cost semantic variants explicit", () => {
    expect(countSearchCostSemanticVariants(searchCostSemanticVariants())).toEqual(searchCostSemanticVariantCounts);

    const weak = searchCostSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps search cost fixtures script-gated and database-independent", () => {
    const weak = searchCostSemanticVariants()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return text.includes("readDatabaseCards")
          || text.includes("hasUpstreamDatabase")
          || !text.includes("workspace.readScript")
          || !text.includes("describe.skipIf(!hasUpstreamScripts || !has");
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function searchCostFixtureFiles(): Array<{ file: string; kind: SearchCostKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-destroyersaurus-self-discard-search.test.ts",
      kind: "selfDiscardFirstMatchSearch",
      required: [
        'const destroyersaurusCode = "80186010"',
        "restores its self-discard ignition search and confirms the first matching Deck card",
        "Cost.SelfDiscardToGrave",
        "Duel.GetFirstMatchingCard(s.filter,tp,LOCATION_DECK,0,nil)",
        "Duel.ConfirmCards(1-tp,tg)",
        "eventReason: duelReason.cost | duelReason.discard",
        "parameter: 1",
      ],
    },
  ];
}

function searchCostSemanticVariants(): Array<{ file: string; kind: SearchCostSemanticVariant; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-destroyersaurus-self-discard-search.test.ts",
      kind: "destroyersaurusSelfDiscardJurassicWorldSearch",
      required: [
        "return c:IsCode(10080320) and c:IsAbleToHand()",
        "{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }",
        'host.messages).not.toContain("destroyersaurus responder resolved")',
      ],
    },
  ];
}

function countSearchCostKinds(fixtures: Array<{ kind: SearchCostKind }>): Record<SearchCostKind, number> {
  return fixtures.reduce<Record<SearchCostKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      selfDiscardFirstMatchSearch: 0,
    },
  );
}

function countSearchCostSemanticVariants(
  fixtures: Array<{ kind: SearchCostSemanticVariant }>,
): Record<SearchCostSemanticVariant, number> {
  return fixtures.reduce<Record<SearchCostSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      destroyersaurusSelfDiscardJurassicWorldSearch: 0,
    },
  );
}
