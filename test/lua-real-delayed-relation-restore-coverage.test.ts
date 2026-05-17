import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const delayedRelationFixtureCount = 4;
const delayedRelationKindCounts = {
  delayedBanishRelation: 1,
  delayedReturnRelation: 1,
  delayedSelfDestroy: 1,
  reviveDestroyRelation: 1,
} satisfies Record<DelayedRelationKind, number>;

type DelayedRelationKind = "delayedBanishRelation" | "delayedReturnRelation" | "delayedSelfDestroy" | "reviveDestroyRelation";

describe("Lua real delayed relation restore coverage", () => {
  it("requires delayed relation fixtures to assert clean Lua registry restore and restored delayed outcomes", () => {
    const files = delayedRelationFixtureFiles();
    expect(files).toHaveLength(delayedRelationFixtureCount);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps delayed relation fixture kinds explicit", () => {
    expect(countDelayedRelationKinds(delayedRelationFixtureFiles())).toEqual(delayedRelationKindCounts);
  });
});

function delayedRelationFixtureFiles(): Array<{
  file: string;
  kind: DelayedRelationKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-kinka-byo-relation-banish.test.ts",
      kind: "delayedBanishRelation",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredRelationWindow.missingRegistryKeys).toEqual([])",
        "restoredRelationWindow.missingChainLimitRegistryKeys).toEqual([])",
        "kinka relation true/true/true",
        'eventName: "specialSummoned"',
        'eventName: "banished"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-call-of-the-haunted-revive-destroy.test.ts",
      kind: "reviveDestroyRelation",
      required: [
        "cardTargetUids: [target!.uid]",
        "call probe 0/612701/1",
        "destroyDuelCard(restoredRevive.session.state, call!.uid",
        "destroyDuelCard(restoredTargetDestroy.session.state, target!.uid",
        "previousLocation: \"spellTrapZone\"",
      ],
    },
    {
      file: "test/lua-real-script-sunlit-sentinel-set-destroy-standby.test.ts",
      kind: "delayedSelfDestroy",
      required: [
        'previousPosition: "faceDown"',
        'triggerEvent: "phaseStandby"',
        'luaConditionDescriptor: "condition:source-turn-next"',
        'type === "activateTrigger"',
        'location: "monsterZone"',
      ],
    },
    {
      file: "test/lua-real-script-yellow-alert-delayed-return.test.ts",
      kind: "delayedReturnRelation",
      required: [
        "code: 0x1080",
        "code: 332",
        'type === "changePhase"',
        'phase === "main2"',
        'location: "hand", controller: 1',
        "expectAttackTarget(restored.session",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DelayedRelationKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countDelayedRelationKinds(
  fixtures: Array<{ kind: DelayedRelationKind }>,
): Record<DelayedRelationKind, number> {
  return fixtures.reduce<Record<DelayedRelationKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      delayedBanishRelation: 0,
      delayedReturnRelation: 0,
      delayedSelfDestroy: 0,
      reviveDestroyRelation: 0,
    },
  );
}
