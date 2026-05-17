import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const resourceGateFixtureCount = 5;
const resourceGateKindCounts = {
  drawPhaseLock: 1,
  effectReleaseLock: 1,
  extraReleaseCost: 1,
  nonDrawPhaseLock: 1,
  unreleasableMonster: 1,
} satisfies Record<ResourceGateKind, number>;

type ResourceGateKind = "drawPhaseLock" | "effectReleaseLock" | "extraReleaseCost" | "nonDrawPhaseLock" | "unreleasableMonster";

describe("Lua real resource gate restore coverage", () => {
  it("requires resource gate fixtures to assert clean restore and restored blocked/allowed outcomes", () => {
    const files = resourceGateFixtureFiles();
    expect(files).toHaveLength(resourceGateFixtureCount);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps resource gate fixture kinds explicit", () => {
    expect(countResourceGateKinds(resourceGateFixtureFiles())).toEqual(resourceGateKindCounts);
  });
});

function resourceGateFixtureFiles(): Array<{
  file: string;
  kind: ResourceGateKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-d-force-plasma-cannot-draw.test.ts",
      kind: "drawPhaseLock",
      required: [
        "code === 25",
        "d force can draw with plasma draw phase false",
        "d force draw with plasma draw phase 0/0",
        "d force can draw with plasma main1 true",
        "d force draw without plasma draw phase 1/1",
      ],
    },
    {
      file: "test/lua-real-script-diabolos-effect-release-lock.test.ts",
      kind: "effectReleaseLock",
      required: [
        "costRestored.missingRegistryKeys).toEqual([])",
        "costRestored.missingChainLimitRegistryKeys).toEqual([])",
        "diabolos release predicates true/false/true",
        "diabolos effect release 1",
        "diabolos cost release 1",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-protector-sanctuary-cannot-draw.test.ts",
      kind: "nonDrawPhaseLock",
      required: [
        "code: 25",
        "protector can draw main1 false",
        "protector draw main1 0/0",
        "protector can draw draw phase true",
        "protector draw draw phase 1/1",
      ],
    },
    {
      file: "test/lua-real-script-red-duston-unreleasable.test.ts",
      kind: "unreleasableMonster",
      required: [
        "code === 43",
        "code === 44",
        "red duston release predicates false/false/false/false",
        "red duston release result 0",
        'location: "monsterZone"',
      ],
    },
    {
      file: "test/lua-real-script-rikka-konkon-extra-release-cost.test.ts",
      kind: "extraReleaseCost",
      required: [
        "code: 158",
        "code: Number(konkonCode)",
        "getLuaRestoreLegalActionGroups",
        "duelReason.release | duelReason.cost",
        'position: "faceUpDefense"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ResourceGateKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countResourceGateKinds(fixtures: Array<{ kind: ResourceGateKind }>): Record<ResourceGateKind, number> {
  return fixtures.reduce<Record<ResourceGateKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      drawPhaseLock: 0,
      effectReleaseLock: 0,
      extraReleaseCost: 0,
      nonDrawPhaseLock: 0,
      unreleasableMonster: 0,
    },
  );
}
