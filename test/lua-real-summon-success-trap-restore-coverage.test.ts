import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const SUMMON_SUCCESS_TRAP_FIXTURE_COUNT = 3;
const summonSuccessTrapKindCounts = {
  banishSummonTrap: 1,
  massDestroySummonTrap: 1,
  singleDestroySummonTrap: 1,
} satisfies Record<SummonSuccessTrapKind, number>;

type SummonSuccessTrapKind = "banishSummonTrap" | "massDestroySummonTrap" | "singleDestroySummonTrap";

describe("Lua real summon-success trap restore coverage", () => {
  it("requires summon-success trap fixtures to assert clean Lua registry restore and restored chain outcomes", () => {
    const files = summonSuccessTrapFixtureFiles();
    expect(files).toHaveLength(SUMMON_SUCCESS_TRAP_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("operationInfos")
          || !text.includes("eventPreviousState")
          || !text.includes("eventCurrentState")
          || !text.includes('type === "passChain"')
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps summon-success trap fixture kinds explicit", () => {
    expect(countSummonSuccessTrapKinds(summonSuccessTrapFixtureFiles())).toEqual(summonSuccessTrapKindCounts);
  });
});

function summonSuccessTrapFixtureFiles(): Array<{
  file: string;
  kind: SummonSuccessTrapKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-bottomless-trap-hole-summon-success.test.ts",
      kind: "banishSummonTrap",
      required: [
        'eventName: "normalSummoned"',
        'eventName: "specialSummoned"',
        "category: 0x1",
        "category: 0x4",
        'location: "banished"',
        'location: "graveyard"',
        "eventUids",
        "bottomless chain starter resolved",
        "bottomless special trigger starter resolved",
        "not.toContain(\"bottomless special summon starter resolved 2\")",
        "not.toContain(\"bottomless chain responder resolved\")",
      ],
    },
    {
      file: "test/lua-real-script-torrential-tribute-summon-success.test.ts",
      kind: "massDestroySummonTrap",
      required: [
        'eventName: "normalSummoned"',
        "assertDestroyOperationInfo",
        "destroyedUids",
        'location: "graveyard"',
        "destroyedEvents",
      ],
    },
    {
      file: "test/lua-real-script-trap-hole-summon-success.test.ts",
      kind: "singleDestroySummonTrap",
      required: [
        'eventName: "normalSummoned"',
        "category: 0x1",
        "targetUids: [summoned!.uid]",
        'location: "graveyard"',
        "destroyedEvents",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonSuccessTrapKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSummonSuccessTrapKinds(
  fixtures: Array<{ kind: SummonSuccessTrapKind }>,
): Record<SummonSuccessTrapKind, number> {
  return fixtures.reduce<Record<SummonSuccessTrapKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      banishSummonTrap: 0,
      massDestroySummonTrap: 0,
      singleDestroySummonTrap: 0,
    },
  );
}
