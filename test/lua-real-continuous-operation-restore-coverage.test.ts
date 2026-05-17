import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const continuousOperationFixtureCount = 4;
const continuousOperationKindCounts = {
  continuousRedirect: 1,
  endPhaseControlReturn: 1,
  originalCodeSummonLock: 1,
  summonTriggerBackrowDestroy: 1,
} satisfies Record<ContinuousOperationKind, number>;

type ContinuousOperationKind =
  | "continuousRedirect"
  | "endPhaseControlReturn"
  | "originalCodeSummonLock"
  | "summonTriggerBackrowDestroy";

describe("Lua real continuous operation restore coverage", () => {
  it("requires continuous operation fixtures to assert clean restore and restored outcomes", () => {
    const files = continuousOperationFixtureFiles();
    expect(files).toHaveLength(continuousOperationFixtureCount);

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

  it("keeps continuous operation fixture kinds explicit", () => {
    expect(countContinuousOperationKinds(continuousOperationFixtureFiles())).toEqual(continuousOperationKindCounts);
  });
});

function continuousOperationFixtureFiles(): Array<{
  file: string;
  kind: ContinuousOperationKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-change-of-heart-control-return.test.ts",
      kind: "endPhaseControlReturn",
      required: [
        "restores Change of Heart's target, control operation, and End Phase return",
        "temporary-control-return",
        "operation: [Function]",
        "previousController: 1",
        "previousController: 0",
        'action.type === "endTurn"',
        "not.toContain(`lua:${targetCode}:temporary-control-return",
      ],
    },
    {
      file: "test/lua-real-script-core-of-chaos-faceup-redirect.test.ts",
      kind: "continuousRedirect",
      required: [
        "condition:source-faceup",
        "code: 60",
        "property: 0x400",
        "duelReason.effect | duelReason.redirect",
        'location: "banished"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-dark-magician-destruction-original-code-lock.test.ts",
      kind: "originalCodeSummonLock",
      required: [
        "target:summon-type-code-any:original:",
        "restored original/current",
        "dark magician fusion special 0",
        "dark magician alternate special 0",
        "other fusion special 1",
      ],
    },
    {
      file: "test/lua-real-script-fenghuang-set-backrow-destroy.test.ts",
      kind: "summonTriggerBackrowDestroy",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "operationInfos: [{ category: 0x1",
        'eventName: "destroyed"',
        "host.messages).not.toContain",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ContinuousOperationKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countContinuousOperationKinds(
  fixtures: Array<{ kind: ContinuousOperationKind }>,
): Record<ContinuousOperationKind, number> {
  return fixtures.reduce<Record<ContinuousOperationKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      continuousRedirect: 0,
      endPhaseControlReturn: 0,
      originalCodeSummonLock: 0,
      summonTriggerBackrowDestroy: 0,
    },
  );
}
