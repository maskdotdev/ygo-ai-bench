import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const flipOperationFixtureCount = 3;
const flipOperationKindCounts = {
  flipGroupDestroy: 1,
  flipSpellTrapDestroy: 1,
  flipTargetToHand: 1,
} satisfies Record<FlipOperationKind, number>;
const flipOperationSemanticVariantCounts = {
  fourStarredLadybugOpponentLevel4GroupDestroy: 1,
  gravekeeperGuardOpponentMonsterReturn: 1,
  wormApocalypseSpellTrapDestroy: 1,
} satisfies Record<FlipOperationSemanticVariant, number>;

type FlipOperationKind = "flipGroupDestroy" | "flipSpellTrapDestroy" | "flipTargetToHand";
type FlipOperationSemanticVariant = "fourStarredLadybugOpponentLevel4GroupDestroy" | "gravekeeperGuardOpponentMonsterReturn" | "wormApocalypseSpellTrapDestroy";

describe("Lua real Flip operation restore coverage", () => {
  it("requires Flip operation fixtures to assert clean Lua registry restore, targets, and operation metadata", () => {
    const fixtures = flipOperationFixtureFiles();
    expect(fixtures).toHaveLength(flipOperationFixtureCount);

    const missing = fixtures
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
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("operationInfos")
          || !text.includes("targetUids")
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps Flip operation fixture kinds explicit", () => {
    expect(countFlipOperationKinds(flipOperationFixtureFiles())).toEqual(flipOperationKindCounts);
  });

  it("keeps named Flip operation semantic variants explicit", () => {
    expect(countFlipOperationSemanticVariants(flipOperationSemanticVariants())).toEqual(flipOperationSemanticVariantCounts);

    const weak = flipOperationSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function flipOperationFixtureFiles(): Array<{ file: string; kind: FlipOperationKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-four-starred-ladybug-flip-group-destroy.test.ts",
      kind: "flipGroupDestroy",
      required: [
        "restores its non-targeted Flip group destruction of opponent face-up Level 4 monsters",
        'const ladybugCode = "83994646"',
        "Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_MZONE,nil)",
        "Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)",
        "Duel.Destroy(g,REASON_EFFECT)",
        "expect(script).not.toContain(\"Duel.SelectTarget\")",
        'eventName: "flipSummoned"',
        'eventName: "destroyed"',
        "operationInfos: [{ category: 0x1",
        "eventUids: destroyedUids",
      ],
    },
    {
      file: "test/lua-real-script-worm-apocalypse-flip-spelltrap-destroy.test.ts",
      kind: "flipSpellTrapDestroy",
      required: [
        "restores Worm Apocalypse's Flip Spell/Trap target, chain response window, and destruction",
        'const wormApocalypseCode = "88650530"',
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
        "Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)",
        "Duel.Destroy(tc,REASON_EFFECT)",
        'eventName: "flipSummoned"',
        'eventName: "destroyed"',
        "operationInfos: [{ category: 0x1",
        "targetUids: [target.uid]",
      ],
    },
    {
      file: "test/lua-real-script-gravekeeper-guard-flip-to-hand.test.ts",
      kind: "flipTargetToHand",
      required: [
        "restores its Flip target and returns an opponent monster to hand",
        'const guardCode = "37101832"',
        "Duel.SelectTarget(tp,Card.IsAbleToHand,tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,#g,0,0)",
        "Duel.SendtoHand(tc,nil,REASON_EFFECT)",
        'eventName: "flipSummoned"',
        'eventName: "sentToHand"',
        "operationInfos: [{ category: 0x8",
        "targetUids: [target.uid]",
      ],
    },
  ];
}

function flipOperationSemanticVariants(): Array<{ file: string; kind: FlipOperationSemanticVariant; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-four-starred-ladybug-flip-group-destroy.test.ts",
      kind: "fourStarredLadybugOpponentLevel4GroupDestroy",
      required: [
        "return c:IsFaceup() and c:GetLevel()==4",
        "expect(script).not.toContain(\"EFFECT_FLAG_CARD_TARGET\")",
        'triggerBucket: "turnMandatory"',
        "eventReasonCardUid: ladybug.uid",
        "eventReasonEffectId: 1",
        'host.messages).not.toContain("ladybug responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-worm-apocalypse-flip-spelltrap-destroy.test.ts",
      kind: "wormApocalypseSpellTrapDestroy",
      required: [
        "if chkc then return chkc:IsOnField() and s.filter(chkc) end",
        'triggerBucket: "turnMandatory"',
        "eventReasonCardUid: wormApocalypse.uid",
        "eventReasonEffectId: 1",
        'host.messages).not.toContain("worm apocalypse magician responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-gravekeeper-guard-flip-to-hand.test.ts",
      kind: "gravekeeperGuardOpponentMonsterReturn",
      required: [
        "chkc:GetControler()~=tp and chkc:IsLocation(LOCATION_MZONE) and chkc:IsAbleToHand()",
        'triggerBucket: "turnMandatory"',
        "eventReasonCardUid: guard.uid",
        "eventReasonEffectId: 1",
        'host.messages).not.toContain("gravekeeper guard responder resolved")',
      ],
    },
  ];
}

function countFlipOperationKinds(fixtures: Array<{ kind: FlipOperationKind }>): Record<FlipOperationKind, number> {
  return fixtures.reduce<Record<FlipOperationKind, number>>((counts, fixture) => {
    counts[fixture.kind] += 1;
    return counts;
  }, { flipGroupDestroy: 0, flipSpellTrapDestroy: 0, flipTargetToHand: 0 });
}

function countFlipOperationSemanticVariants(
  fixtures: Array<{ kind: FlipOperationSemanticVariant }>,
): Record<FlipOperationSemanticVariant, number> {
  return fixtures.reduce<Record<FlipOperationSemanticVariant, number>>((counts, fixture) => {
    counts[fixture.kind] += 1;
    return counts;
  }, { fourStarredLadybugOpponentLevel4GroupDestroy: 0, gravekeeperGuardOpponentMonsterReturn: 0, wormApocalypseSpellTrapDestroy: 0 });
}
