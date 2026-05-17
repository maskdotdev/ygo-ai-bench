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
const delayedRelationSemanticVariantCounts = {
  callOfTheHauntedMutualDestroyRelation: 1,
  kinkaByoReviveLeavesBanishRelation: 1,
  sunlitSentinelPreviousPositionStandbyCheck: 1,
  yellowAlertBattlePhaseReturnRelation: 1,
} satisfies Record<DelayedRelationSemanticVariant, number>;

type DelayedRelationKind = "delayedBanishRelation" | "delayedReturnRelation" | "delayedSelfDestroy" | "reviveDestroyRelation";
type DelayedRelationSemanticVariant =
  | "callOfTheHauntedMutualDestroyRelation"
  | "kinkaByoReviveLeavesBanishRelation"
  | "sunlitSentinelPreviousPositionStandbyCheck"
  | "yellowAlertBattlePhaseReturnRelation";

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

  it("keeps named delayed-relation semantic variants explicit", () => {
    expect(countDelayedRelationSemanticVariants(delayedRelationSemanticVariants())).toEqual(delayedRelationSemanticVariantCounts);

    const weak = delayedRelationSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
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

function delayedRelationSemanticVariants(): Array<{
  file: string;
  kind: DelayedRelationSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-call-of-the-haunted-revive-destroy.test.ts",
      kind: "callOfTheHauntedMutualDestroyRelation",
      required: [
        'const callCode = "97077563"',
        "restores Call of the Haunted's Continuous Trap revive and mutual destruction",
        "destroyDuelCard(restoredRevive.session.state, call!.uid",
        "destroyDuelCard(restoredTargetDestroy.session.state, target!.uid",
      ],
    },
    {
      file: "test/lua-real-script-kinka-byo-relation-banish.test.ts",
      kind: "kinkaByoReviveLeavesBanishRelation",
      required: [
        'const kinkaCode = "45452224"',
        "restores its revive relation and banishes the revived monster when Kinka-byo leaves",
        "kinka relation true/true/true",
        'eventName: "banished"',
      ],
    },
    {
      file: "test/lua-real-script-sunlit-sentinel-set-destroy-standby.test.ts",
      kind: "sunlitSentinelPreviousPositionStandbyCheck",
      required: [
        'const sentinelCode = "78360952"',
        "restores its face-down Spell/Trap previous-position check into the next Standby Special Summon",
        'previousPosition: "faceDown"',
        'luaConditionDescriptor: "condition:source-turn-next"',
      ],
    },
    {
      file: "test/lua-real-script-yellow-alert-delayed-return.test.ts",
      kind: "yellowAlertBattlePhaseReturnRelation",
      required: [
        'const yellowAlertCode = "59277750"',
        "restores the temporary battle target lock and returns the summoned monster at the end of the Battle Phase",
        'type === "changePhase"',
        "expectAttackTarget(restored.session",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DelayedRelationSemanticVariant;
    required: string[];
  }>);
}

function countDelayedRelationSemanticVariants(
  fixtures: Array<{ kind: DelayedRelationSemanticVariant }>,
): Record<DelayedRelationSemanticVariant, number> {
  return fixtures.reduce<Record<DelayedRelationSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      callOfTheHauntedMutualDestroyRelation: 0,
      kinkaByoReviveLeavesBanishRelation: 0,
      sunlitSentinelPreviousPositionStandbyCheck: 0,
      yellowAlertBattlePhaseReturnRelation: 0,
    },
  );
}
