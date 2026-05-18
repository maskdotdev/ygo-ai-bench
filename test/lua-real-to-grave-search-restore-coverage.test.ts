import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const toGraveSearchFixtureCount = 1;
const toGraveSearchKindCounts = {
  destroyedFromFieldMandatorySearch: 1,
} satisfies Record<ToGraveSearchKind, number>;
const toGraveSearchSemanticVariantCounts = {
  reptilianneGardnaDestroyedFromFieldSearch: 1,
} satisfies Record<ToGraveSearchSemanticVariant, number>;

type ToGraveSearchKind = "destroyedFromFieldMandatorySearch";
type ToGraveSearchSemanticVariant = "reptilianneGardnaDestroyedFromFieldSearch";

describe("Lua real to-Grave search restore coverage", () => {
  it("requires to-Grave search fixtures to assert clean Lua registry restore and restored legal actions", () => {
    const fixtures = toGraveSearchFixtureFiles();
    expect(fixtures).toHaveLength(toGraveSearchFixtureCount);

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

  it("requires to-Grave search fixtures to prove trigger metadata, operation info, and confirmation events", () => {
    const fixtures = toGraveSearchFixtureFiles();
    expect(fixtures).toHaveLength(toGraveSearchFixtureCount);

    const missing = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("operationInfos")
          || !text.includes("category: 0x8")
          || !text.includes('eventName: "sentToGraveyard"')
          || !text.includes('eventName: "sentToHand"')
          || !text.includes('eventName: "sentToHandConfirmed"')
          || !text.includes('triggerBucket: "turnMandatory"')
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps to-Grave search fixture kinds explicit", () => {
    expect(countToGraveSearchKinds(toGraveSearchFixtureFiles())).toEqual(toGraveSearchKindCounts);
  });

  it("keeps named to-Grave search semantic variants explicit", () => {
    expect(countToGraveSearchSemanticVariants(toGraveSearchSemanticVariants())).toEqual(toGraveSearchSemanticVariantCounts);

    const weak = toGraveSearchSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function toGraveSearchFixtureFiles(): Array<{ file: string; kind: ToGraveSearchKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-reptilianne-gardna-to-grave-search.test.ts",
      kind: "destroyedFromFieldMandatorySearch",
      required: [
        'const gardnaCode = "43002864"',
        "restores its mandatory destroyed-from-field EVENT_TO_GRAVE Reptilianne search",
        "c:IsReason(REASON_DESTROY) and c:IsPreviousLocation(LOCATION_ONFIELD) and c:IsPreviousControler(tp)",
        "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil)",
        "Duel.ConfirmCards(1-tp,g)",
        "eventReason: duelReason.effect | duelReason.destroy",
      ],
    },
  ];
}

function toGraveSearchSemanticVariants(): Array<{ file: string; kind: ToGraveSearchSemanticVariant; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-reptilianne-gardna-to-grave-search.test.ts",
      kind: "reptilianneGardnaDestroyedFromFieldSearch",
      required: [
        "return c:IsSetCard(SET_REPTILIANNE) and c:IsMonster() and c:IsAbleToHand()",
        "{ category: 0x8, targetUids: [], count: 1, player: 0, parameter: 1 }",
        'location: "graveyard"',
        'host.messages).not.toContain("reptilianne responder resolved")',
      ],
    },
  ];
}

function countToGraveSearchKinds(fixtures: Array<{ kind: ToGraveSearchKind }>): Record<ToGraveSearchKind, number> {
  return fixtures.reduce<Record<ToGraveSearchKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      destroyedFromFieldMandatorySearch: 0,
    },
  );
}

function countToGraveSearchSemanticVariants(
  fixtures: Array<{ kind: ToGraveSearchSemanticVariant }>,
): Record<ToGraveSearchSemanticVariant, number> {
  return fixtures.reduce<Record<ToGraveSearchSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      reptilianneGardnaDestroyedFromFieldSearch: 0,
    },
  );
}
