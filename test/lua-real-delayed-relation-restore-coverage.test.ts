import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const delayedRelationFixtureCount = 8;
const delayedRelationKindCounts = {
  banishedReviveDestroyRelation: 1,
  battleMarkerEndPhaseDestroy: 1,
  delayedBanishRelation: 1,
  delayedNextTurnDestroy: 1,
  delayedReturnRelation: 1,
  delayedSelfDestroy: 1,
  reviveEndPhaseDestroy: 1,
  reviveDestroyRelation: 1,
} satisfies Record<DelayedRelationKind, number>;
const delayedRelationSemanticVariantCounts = {
  callOfTheHauntedMutualDestroyRelation: 1,
  engraverMarkNextTurnDelayedDestroy: 1,
  junkBoxMorphtronicReviveEndDestroy: 1,
  kinkaByoReviveLeavesBanishRelation: 1,
  releaseFromStoneBanishedReviveDestroyRelation: 1,
  sunlitSentinelPreviousPositionStandbyCheck: 1,
  yellowAlertBattlePhaseReturnRelation: 1,
  zoneEaterBattleMarkerEndPhaseDestroy: 1,
} satisfies Record<DelayedRelationSemanticVariant, number>;

type DelayedRelationKind =
  | "banishedReviveDestroyRelation"
  | "battleMarkerEndPhaseDestroy"
  | "delayedBanishRelation"
  | "delayedNextTurnDestroy"
  | "delayedReturnRelation"
  | "delayedSelfDestroy"
  | "reviveEndPhaseDestroy"
  | "reviveDestroyRelation";
type DelayedRelationSemanticVariant =
  | "callOfTheHauntedMutualDestroyRelation"
  | "engraverMarkNextTurnDelayedDestroy"
  | "junkBoxMorphtronicReviveEndDestroy"
  | "kinkaByoReviveLeavesBanishRelation"
  | "releaseFromStoneBanishedReviveDestroyRelation"
  | "sunlitSentinelPreviousPositionStandbyCheck"
  | "yellowAlertBattlePhaseReturnRelation"
  | "zoneEaterBattleMarkerEndPhaseDestroy";

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
      file: "test/lua-real-script-engraver-mark-delayed-destroy.test.ts",
      kind: "delayedNextTurnDestroy",
      required: [
        'const engraverCode = "50078320"',
        "aux.DelayedOperation(tc,PHASE_END,id,e,tp,",
        "function() return Duel.GetTurnCount()==turn_count+1 end",
        "advanceRestoredToEndTurn(restoredSameEnd, 0)",
        "advanceRestoredToEndTurn(restoredNextEnd, 1)",
        'eventName: "destroyed"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-junk-box-revive-end-destroy.test.ts",
      kind: "reviveEndPhaseDestroy",
      required: [
        "restores its Morphtronic Graveyard revive and target-owned End Phase destruction watcher",
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
        "e1:SetCode(EVENT_PHASE+PHASE_END)",
        "Duel.Destroy(e:GetHandler(),REASON_EFFECT)",
        "advanceRestoredToPhase(restoredEndPhase, 0, [\"battle\", \"main2\", \"end\"])",
        'triggerEvent: "phaseEnd"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-zone-eater-delayed-battle-destroy.test.ts",
      kind: "battleMarkerEndPhaseDestroy",
      required: [
        "restores battled target markers and destroys the marked monster on the fifth End Phase",
        "bc:RegisterEffect(e1)",
        "e3:SetCode(EVENT_PHASE+PHASE_END)",
        "Duel.Destroy(tc,REASON_EFFECT)",
        'triggerEvent === "phaseEnd"',
        'location: "graveyard"',
      ],
    },
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
      file: "test/lua-real-script-release-from-stone-banished-revive-destroy.test.ts",
      kind: "banishedReviveDestroyRelation",
      required: [
        "restores its banished Rock target, SpecialSummonStep relation, and mutual destruction cleanup",
        "Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)",
        "c:SetCardTarget(tc)",
        "release probe 0/26956671/1",
        "destroyDuelCard(restoredRelation.session.state, release.uid",
        "destroyDuelCard(restoredTargetDestroy.session.state, rockTarget.uid",
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
      banishedReviveDestroyRelation: 0,
      battleMarkerEndPhaseDestroy: 0,
      delayedBanishRelation: 0,
      delayedNextTurnDestroy: 0,
      delayedReturnRelation: 0,
      delayedSelfDestroy: 0,
      reviveEndPhaseDestroy: 0,
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
      file: "test/lua-real-script-engraver-mark-delayed-destroy.test.ts",
      kind: "engraverMarkNextTurnDelayedDestroy",
      required: [
        'const engraverCode = "50078320"',
        "restores its targeted aux.DelayedOperation and destroys the marked card during the next turn End Phase",
        "Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,g,1,tp,0)",
        "Duel.Destroy(ag,REASON_EFFECT)",
        "eventReasonEffectId: 3",
      ],
    },
    {
      file: "test/lua-real-script-junk-box-revive-end-destroy.test.ts",
      kind: "junkBoxMorphtronicReviveEndDestroy",
      required: [
        'const junkBoxCode = "37745919"',
        "restores its Morphtronic Graveyard revive and target-owned End Phase destruction watcher",
        "return c:IsSetCard(SET_MORPHTRONIC) and c:IsLevelBelow(4) and c:IsCanBeSpecialSummoned(e,0,tp,false,false)",
        "Duel.Destroy(e:GetHandler(),REASON_EFFECT)",
        "advanceRestoredToPhase(restoredEndPhase, 0, [\"battle\", \"main2\", \"end\"])",
      ],
    },
    {
      file: "test/lua-real-script-zone-eater-delayed-battle-destroy.test.ts",
      kind: "zoneEaterBattleMarkerEndPhaseDestroy",
      required: [
        'const zoneEaterCode = "86100785"',
        "restores battled target markers and destroys the marked monster on the fifth End Phase",
        "Duel.HintSelection(sg)",
        "Duel.Destroy(tc,REASON_EFFECT)",
        "reasonCardUid: zoneEater.uid",
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
      file: "test/lua-real-script-release-from-stone-banished-revive-destroy.test.ts",
      kind: "releaseFromStoneBanishedReviveDestroyRelation",
      required: [
        'const releaseCode = "26956670"',
        "restores its banished Rock target, SpecialSummonStep relation, and mutual destruction cleanup",
        "Duel.SpecialSummonStep(tc,0,tp,tp,false,false,POS_FACEUP)",
        "release probe 0/26956671/1",
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
      engraverMarkNextTurnDelayedDestroy: 0,
      junkBoxMorphtronicReviveEndDestroy: 0,
      kinkaByoReviveLeavesBanishRelation: 0,
      releaseFromStoneBanishedReviveDestroyRelation: 0,
      sunlitSentinelPreviousPositionStandbyCheck: 0,
      yellowAlertBattlePhaseReturnRelation: 0,
      zoneEaterBattleMarkerEndPhaseDestroy: 0,
    },
  );
}
