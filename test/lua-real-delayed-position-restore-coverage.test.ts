import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const delayedPositionFixtureCount = 4;
const delayedPositionKindCounts = {
  battlePhaseCleanup: 1,
  damageStepPositionChange: 1,
  endPhaseFlipDraw: 1,
  endPhaseSetGroup: 1,
} satisfies Record<DelayedPositionKind, number>;

type DelayedPositionKind = "battlePhaseCleanup" | "damageStepPositionChange" | "endPhaseFlipDraw" | "endPhaseSetGroup";

describe("Lua real delayed position restore coverage", () => {
  it("requires delayed position fixtures to assert clean restore and restored delayed outcomes", () => {
    const files = delayedPositionFixtureFiles();
    expect(files).toHaveLength(delayedPositionFixtureCount);

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

  it("keeps delayed position fixture kinds explicit", () => {
    expect(countDelayedPositionKinds(delayedPositionFixtureFiles())).toEqual(delayedPositionKindCounts);
  });
});

function delayedPositionFixtureFiles(): Array<{
  file: string;
  kind: DelayedPositionKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-big-shield-gardna-damage-step-position.test.ts",
      kind: "damageStepPositionChange",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        'eventName: "positionChanged"',
        "position: \"faceUpDefense\"",
        "position: \"faceUpAttack\"",
      ],
    },
    {
      file: "test/lua-real-script-unleash-your-power-gemini-delayed-set.test.ts",
      kind: "endPhaseSetGroup",
      required: [
        "restores group-wide Gemini status and delayed End Phase position change",
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredActivation.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredStatus.missingRegistryKeys).toEqual([])",
        "restoredStatus.missingChainLimitRegistryKeys).toEqual([])",
        "restoredAfterEnd.missingRegistryKeys).toEqual([])",
        "restoredAfterEnd.missingChainLimitRegistryKeys).toEqual([])",
        'action.type === "changePhase"',
        "position: \"faceUpAttack\"",
        "position: \"faceUpDefense\"",
        "position: \"faceDownDefense\"",
        'eventName: "positionChanged"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-book-eclipse-delayed-flip-draw.test.ts",
      kind: "endPhaseFlipDraw",
      required: [
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredActivation.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredEnd.missingRegistryKeys).toEqual([])",
        "restoredEnd.missingChainLimitRegistryKeys).toEqual([])",
        "operationInfos: [",
        "position: \"faceDownDefense\"",
        "position: \"faceUpDefense\"",
        'action.type === "changePhase"',
        'location: "hand", controller: 1',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-giant-orc-battle-phase-position.test.ts",
      kind: "battlePhaseCleanup",
      required: [
        "restored.missingRegistryKeys).toEqual([])",
        "restored.missingChainLimitRegistryKeys).toEqual([])",
        'action.type === "changePhase" && action.phase === "main2"',
        'eventName: "phaseBattle"',
        'eventName: "positionChanged"',
        "position: \"faceUpDefense\"",
        "battlePairs",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DelayedPositionKind;
    required: string[];
  }>);
}

function countDelayedPositionKinds(
  fixtures: Array<{ kind: DelayedPositionKind }>,
): Record<DelayedPositionKind, number> {
  return fixtures.reduce<Record<DelayedPositionKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      battlePhaseCleanup: 0,
      damageStepPositionChange: 0,
      endPhaseFlipDraw: 0,
      endPhaseSetGroup: 0,
    },
  );
}
