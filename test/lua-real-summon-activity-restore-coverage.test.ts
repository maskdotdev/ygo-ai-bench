import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const summonActivityFixtureCount = 6;
const summonActivityKindCounts = {
  archetypeExtraNormalSummon: 2,
  genericExtraNormalSummon: 1,
  ignitionEffectNormalSummon: 1,
  specialSummonOath: 1,
  spiritExtraNormalSummon: 1,
} satisfies Record<SummonActivityKind, number>;
const summonActivitySemanticVariantCounts = {
  constellarLeonisExtraConstellarNormalSummon: 1,
  constellarPolluxSummonSuccessFlaggedExtraConstellarNormalSummon: 1,
  doubleSummonSecondNormalSummonGrant: 1,
  mahunderIgnitionNormalSummonFromHand: 1,
  nikitamaAdditionalSpiritNormalSummon: 1,
  thunderSeaHorseTemporarySpecialSummonOath: 1,
} satisfies Record<SummonActivitySemanticVariant, number>;

type SummonActivityKind =
  | "archetypeExtraNormalSummon"
  | "genericExtraNormalSummon"
  | "ignitionEffectNormalSummon"
  | "specialSummonOath"
  | "spiritExtraNormalSummon";
type SummonActivitySemanticVariant =
  | "constellarLeonisExtraConstellarNormalSummon"
  | "constellarPolluxSummonSuccessFlaggedExtraConstellarNormalSummon"
  | "doubleSummonSecondNormalSummonGrant"
  | "mahunderIgnitionNormalSummonFromHand"
  | "nikitamaAdditionalSpiritNormalSummon"
  | "thunderSeaHorseTemporarySpecialSummonOath";

describe("Lua real summon activity restore coverage", () => {
  it("requires summon activity fixtures to assert clean restore and restored legal actions", () => {
    const files = summonActivityFixtureFiles();
    expect(files).toHaveLength(summonActivityFixtureCount);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps summon activity fixture kinds explicit", () => {
    expect(countSummonActivityKinds(summonActivityFixtureFiles())).toEqual(summonActivityKindCounts);
  });

  it("keeps named summon activity semantic variants explicit", () => {
    expect(countSummonActivitySemanticVariants(summonActivitySemanticVariants())).toEqual(
      summonActivitySemanticVariantCounts,
    );

    const weak = summonActivitySemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps summon activity fixtures script-gated and database-independent", () => {
    const weak = summonActivitySemanticVariants()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return text.includes("readDatabaseCards")
          || text.includes("hasUpstreamDatabase")
          || !text.includes("workspace.readScript")
          || !text.includes("describe.skipIf(!hasUpstreamScripts || !has");
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function summonActivityFixtureFiles(): Array<{
  file: string;
  kind: SummonActivityKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-constellar-leonis-extra-summon-count.test.ts",
      kind: "archetypeExtraNormalSummon",
      required: [
        "extra Constellar Normal Summon",
        "normalSummonAvailable).toBe(false)",
        "getLuaRestoreLegalActionGroups",
        'action.type === "normalSummon"',
        "activityCounts[0].normalSummon).toBe(2)",
      ],
    },
    {
      file: "test/lua-real-script-constellar-pollux-extra-summon-flag.test.ts",
      kind: "archetypeExtraNormalSummon",
      required: [
        "summon-success Constellar-only extra Normal Summon",
        "if Duel.GetFlagEffect(tp,id)~=0 then return end",
        "e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_CONSTELLAR))",
        "Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,0,1)",
        "pollux extra flag 1",
        "activityCounts[0].normalSummon).toBe(2)",
      ],
    },
    {
      file: "test/lua-real-script-double-summon-count-limit.test.ts",
      kind: "genericExtraNormalSummon",
      required: [
        "code: 28",
        "value: 2",
        "getLuaRestoreLegalActionGroups",
        'action.type === "normalSummon"',
        "activityCounts[0].normalSummon).toBe(2)",
      ],
    },
    {
      file: "test/lua-real-script-mahunder-ignition-normal-summon.test.ts",
      kind: "ignitionEffectNormalSummon",
      required: [
        "restores CATEGORY_SUMMON ignition selection and Duel.Summon from hand",
        "e1:SetCategory(CATEGORY_SUMMON)",
        "e1:SetType(EFFECT_TYPE_IGNITION)",
        "Duel.SetOperationInfo(0,CATEGORY_SUMMON,nil,1,0,0)",
        "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil)",
        "Duel.Summon(tp,tc,true,nil)",
        "operationInfos: [{ category: 0x100",
        'eventName: "normalSummoned"',
        "activityCounts[0].normalSummon).toBe(1)",
      ],
    },
    {
      file: "test/lua-real-script-nikitama-extra-spirit-summon.test.ts",
      kind: "spiritExtraNormalSummon",
      required: [
        "additional Spirit Normal Summon",
        "normalSummonAvailable).toBe(false)",
        "getLuaRestoreLegalActionGroups",
        'action.type === "normalSummon"',
        "activityCounts[0].normalSummon).toBe(2)",
        "overLimit).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-thunder-sea-horse-special-oath.test.ts",
      kind: "specialSummonOath",
      required: [
        "sea horse can special locked false",
        "sea horse special locked 0",
        "sea horse can special after end true",
        "sea horse special after end 1",
        'action.type === "endTurn"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonActivityKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSummonActivityKinds(
  fixtures: Array<{ kind: SummonActivityKind }>,
): Record<SummonActivityKind, number> {
  return fixtures.reduce<Record<SummonActivityKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      archetypeExtraNormalSummon: 0,
      genericExtraNormalSummon: 0,
      ignitionEffectNormalSummon: 0,
      specialSummonOath: 0,
      spiritExtraNormalSummon: 0,
    },
  );
}

function summonActivitySemanticVariants(): Array<{
  file: string;
  kind: SummonActivitySemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-constellar-leonis-extra-summon-count.test.ts",
      kind: "constellarLeonisExtraConstellarNormalSummon",
      required: [
        'const leonisCode = "17129783"',
        "restores Leonis's extra Constellar Normal Summon after the regular summon is spent",
        "activityCounts[0].normalSummon).toBe(2)",
      ],
    },
    {
      file: "test/lua-real-script-constellar-pollux-extra-summon-flag.test.ts",
      kind: "constellarPolluxSummonSuccessFlaggedExtraConstellarNormalSummon",
      required: [
        'const polluxCode = "78364470"',
        "restores its summon-success Constellar-only extra Normal Summon and once-per-turn flag",
        "action.uid === offArchetype.uid)).toBeUndefined()",
        "pollux extra flag 1",
      ],
    },
    {
      file: "test/lua-real-script-double-summon-count-limit.test.ts",
      kind: "doubleSummonSecondNormalSummonGrant",
      required: [
        'const doubleSummonCode = "43422537"',
        "lets official Double Summon grant a second Normal Summon legal action",
        "activityCounts[0].normalSummon).toBe(2)",
      ],
    },
    {
      file: "test/lua-real-script-mahunder-ignition-normal-summon.test.ts",
      kind: "mahunderIgnitionNormalSummonFromHand",
      required: [
        'const mahunderCode = "21524779"',
        "return c:IsRace(RACE_THUNDER) and c:IsAttribute(ATTRIBUTE_LIGHT) and c:GetLevel()==4",
        "and c:GetCode()~=id and c:IsSummonable(true,nil)",
        "Duel.Summon(tp,tc,true,nil)",
        "sameCodeDecoy.uid)).toMatchObject({ location: \"hand\"",
        "darkThunder.uid)).toMatchObject({ location: \"hand\"",
        "highLevel.uid)).toMatchObject({ location: \"hand\"",
        "mahunder responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-nikitama-extra-spirit-summon.test.ts",
      kind: "nikitamaAdditionalSpiritNormalSummon",
      required: [
        'const nikitamaCode = "24701235"',
        "restores its official additional Spirit Normal Summon count",
        "overLimit).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-thunder-sea-horse-special-oath.test.ts",
      kind: "thunderSeaHorseTemporarySpecialSummonOath",
      required: [
        'const seaHorseCode = "48049769"',
        "restores its cost-created temporary EFFECT_CANNOT_SPECIAL_SUMMON and expires it at End Phase",
        "sea horse can special locked false",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonActivitySemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSummonActivitySemanticVariants(
  fixtures: Array<{ kind: SummonActivitySemanticVariant }>,
): Record<SummonActivitySemanticVariant, number> {
  return fixtures.reduce<Record<SummonActivitySemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      constellarLeonisExtraConstellarNormalSummon: 0,
      constellarPolluxSummonSuccessFlaggedExtraConstellarNormalSummon: 0,
      doubleSummonSecondNormalSummonGrant: 0,
      mahunderIgnitionNormalSummonFromHand: 0,
      nikitamaAdditionalSpiritNormalSummon: 0,
      thunderSeaHorseTemporarySpecialSummonOath: 0,
    },
  );
}
