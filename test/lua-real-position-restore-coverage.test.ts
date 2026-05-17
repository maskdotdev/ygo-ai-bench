import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const POSITION_FIXTURE_COUNT = 4;
const positionKindCounts = {
  banishCostGroupChange: 1,
  overlayTargetChange: 1,
  summonTriggerAttackPosition: 1,
  summonTriggerSet: 1,
} satisfies Record<PositionKind, number>;

type PositionKind = "banishCostGroupChange" | "overlayTargetChange" | "summonTriggerAttackPosition" | "summonTriggerSet";

describe("Lua real position restore coverage", () => {
  it("requires position-changing summon triggers to assert clean Lua registry restore and restored outcomes", () => {
    const files = positionFixtureFiles();
    expect(files).toHaveLength(POSITION_FIXTURE_COUNT);

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
          || !text.includes("eventHistory")
          || !text.includes('eventName: "positionChanged"')
          || !text.includes("host.messages).not.toContain")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps position fixture kinds explicit", () => {
    expect(countPositionKinds(positionFixtureFiles())).toEqual(positionKindCounts);
  });
});

function positionFixtureFiles(): Array<{
  file: string;
  kind: PositionKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-angineer-overlay-position.test.ts",
      kind: "overlayTargetChange",
      required: [
        "targetUids: [target!.uid]",
        'eventName: "detachedMaterial"',
        "positionsChanged).toEqual([target!.uid])",
        "overlayUids: []",
      ],
    },
    {
      file: "test/lua-real-script-gagaga-escape-position-lockout.test.ts",
      kind: "banishCostGroupChange",
      required: [
        "category: 0x1000",
        "positionsChanged).toEqual([changed!.uid, eligible!.uid])",
        'eventName: "banished"',
        'position: "faceUpDefense", faceUp: true',
      ],
    },
    {
      file: "test/lua-real-script-otohime-position-overload.test.ts",
      kind: "summonTriggerAttackPosition",
      required: [
        "operationInfos: [{ category: 0x1000",
        "parameter: 0",
        'position: "faceUpAttack", faceUp: true',
      ],
    },
    {
      file: "test/lua-real-script-tsukuyomi-position-trigger.test.ts",
      kind: "summonTriggerSet",
      required: [
        "operationInfos: [{ category: 0x1000",
        "parameter: 0x8",
        'position: "faceDownDefense", faceUp: false',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PositionKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPositionKinds(fixtures: Array<{ kind: PositionKind }>): Record<PositionKind, number> {
  return fixtures.reduce<Record<PositionKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      banishCostGroupChange: 0,
      overlayTargetChange: 0,
      summonTriggerAttackPosition: 0,
      summonTriggerSet: 0,
    },
  );
}
