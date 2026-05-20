import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const publicVisibilityFixtureCount = 1;
const publicVisibilityKindCounts = {
  opponentHandPublic: 1,
} satisfies Record<PublicVisibilityKind, number>;
const publicVisibilitySemanticVariantCounts = {
  mindOnAirOpponentHandPublic: 1,
} satisfies Record<PublicVisibilitySemanticVariant, number>;

type PublicVisibilityKind = "opponentHandPublic";
type PublicVisibilitySemanticVariant = "mindOnAirOpponentHandPublic";

describe("Lua real public visibility restore coverage", () => {
  it("requires public visibility fixtures to assert clean restore and public hand-state semantics", () => {
    const files = publicVisibilityFixtureFiles();
    expect(files).toHaveLength(publicVisibilityFixtureCount);

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
          || !text.includes("queryPublicState")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps named public visibility semantic variants explicit", () => {
    expect(countPublicVisibilityKinds(publicVisibilityFixtureFiles())).toEqual(publicVisibilityKindCounts);
    expect(countPublicVisibilitySemanticVariants(publicVisibilityFixtureFiles())).toEqual(publicVisibilitySemanticVariantCounts);
  });
});

function publicVisibilityFixtureFiles(): Array<{
  file: string;
  kind: PublicVisibilityKind;
  semanticVariant: PublicVisibilitySemanticVariant;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-mind-on-air-public-hand.test.ts",
      kind: "opponentHandPublic",
      semanticVariant: "mindOnAirOpponentHandPublic",
      required: [
        'const mindOnAirCode = "66690411"',
        "restores opponent-hand EFFECT_PUBLIC visibility into public duel state",
        "e1:SetCode(EFFECT_PUBLIC)",
        "e1:SetTargetRange(0,LOCATION_HAND)",
        "code: 160",
        "targetRange: [0, 2]",
        "revealedToPlayers: undefined",
        "revealedToPlayers: [0, 1]",
      ],
    },
  ];
}

function countPublicVisibilitySemanticVariants(
  fixtures: Array<{ semanticVariant: PublicVisibilitySemanticVariant }>,
): Record<PublicVisibilitySemanticVariant, number> {
  return fixtures.reduce<Record<PublicVisibilitySemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.semanticVariant] += 1;
      return counts;
    },
    {
      mindOnAirOpponentHandPublic: 0,
    },
  );
}

function countPublicVisibilityKinds(fixtures: Array<{ kind: PublicVisibilityKind }>): Record<PublicVisibilityKind, number> {
  return fixtures.reduce<Record<PublicVisibilityKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      opponentHandPublic: 0,
    },
  );
}
