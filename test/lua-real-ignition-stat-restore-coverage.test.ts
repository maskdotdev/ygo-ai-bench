import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const ignitionStatFixtureCount = 5;
const ignitionStatKindCounts = {
  groupUpdateLevel: 1,
  noTurnResetAttackLevelBoost: 1,
  selfToGraveTargetUpdateLevel: 1,
  summedLevelChange: 1,
  targetLevelCopy: 1,
} satisfies Record<IgnitionStatKind, number>;

type IgnitionStatKind = "groupUpdateLevel" | "noTurnResetAttackLevelBoost" | "selfToGraveTargetUpdateLevel" | "summedLevelChange" | "targetLevelCopy";
type IgnitionStatFixture = { file: string; kind: IgnitionStatKind; required: string[] };

describe("Lua real ignition stat restore coverage", () => {
  it("requires ignition stat fixtures to assert clean Lua registry restore and restored legal-action parity", () => {
    const fixtures = realScriptIgnitionStatFixtures();
    expect(fixtures).toHaveLength(ignitionStatFixtureCount);

    const missing = fixtures.filter(({ file, required }) => {
      const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
      return !text.includes("restoreComplete")
        || !text.includes('incompleteReasons.join("; ")')
        || !text.includes("missingRegistryKeys).toEqual([])")
        || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
        || !text.includes("getLuaRestoreLegalActions")
        || !text.includes("getLuaRestoreLegalActionGroups")
        || !text.includes("getGroupedDuelLegalActions")
        || !text.includes("flatMap((group) => group.actions)).toEqual")
        || required.some((snippet) => !hasCoverageSnippet(text, snippet));
    });

    expect(missing).toEqual([]);
  });

  it("keeps ignition stat behavior variants explicit", () => {
    expect(countIgnitionStatKinds(realScriptIgnitionStatFixtures())).toEqual(ignitionStatKindCounts);
  });
});

function realScriptIgnitionStatFixtures(): IgnitionStatFixture[] {
  return [
    {
      file: "test/lua-real-script-copy-plant-target-level-change.test.ts",
      kind: "targetLevelCopy",
      required: [
        "e1:SetType(EFFECT_TYPE_IGNITION)",
        "e1:SetRange(LOCATION_MZONE)",
        "e1:SetCountLimit(1)",
        "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
        "Duel.SelectTarget(tp,s.lvfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,c,lvl)",
        "local tc=Duel.GetFirstTarget()",
        "e1:SetCode(EFFECT_CHANGE_LEVEL)",
        "e1:SetValue(tc:GetLevel())",
        "currentLevel(restoredCopyPlant, restoredChain.session.state)).toBe(4)",
        "copy plant level 4",
      ],
    },
    {
      file: "test/lua-real-script-shogi-lance-summed-level-change.test.ts",
      kind: "summedLevelChange",
      required: [
        "e1:SetType(EFFECT_TYPE_IGNITION)",
        "e1:SetRange(LOCATION_MZONE)",
        "e1:SetCountLimit(1)",
        "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
        "return c:IsFaceup() and c:GetLevel()==3 and c:IsRace(RACE_BEASTWARRIOR)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,e:GetHandler())",
        "local lv=c:GetLevel()+tc:GetLevel()",
        "e1:SetCode(EFFECT_CHANGE_LEVEL)",
        "tc:RegisterEffect(e2)",
        "currentLevel(restoredShogiLance, restoredChain.session.state)).toBe(7)",
        "shogi lance level 7",
      ],
    },
    {
      file: "test/lua-real-script-starfish-group-update-level.test.ts",
      kind: "groupUpdateLevel",
      required: [
        "e1:SetType(EFFECT_TYPE_IGNITION)",
        "e1:SetRange(LOCATION_MZONE)",
        "e1:SetCountLimit(1)",
        "Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,1,nil)",
        "local g=Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil)",
        "for tc in aux.Next(g) do",
        "e1:SetCode(EFFECT_UPDATE_LEVEL)",
        "tc:RegisterEffect(e1)",
        "currentLevel(card, restoredChain.session.state))).toEqual([4, 4])",
        "starfish level 4",
        "starfish decoy level 3",
      ],
    },
    {
      file: "test/lua-real-script-silent-strider-self-grave-level.test.ts",
      kind: "selfToGraveTargetUpdateLevel",
      required: [
        "e1:SetType(EFFECT_TYPE_IGNITION)",
        "e1:SetRange(LOCATION_HAND)",
        "e1:SetCost(Cost.SelfToGrave)",
        "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
        "Duel.SelectTarget(tp,s.lvfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
        "local tc=Duel.GetFirstTarget()",
        "e1:SetCode(EFFECT_UPDATE_LEVEL)",
        "e1:SetValue(-1)",
        "currentLevel(restoredTarget, restoredChain.session.state)).toBe(3)",
        "silent strider level 3",
      ],
    },
    {
      file: "test/lua-real-script-wind-up-no-turn-reset-stat.test.ts",
      kind: "noTurnResetAttackLevelBoost",
      required: [
        "e1:SetType(EFFECT_TYPE_IGNITION)",
        "e1:SetRange(LOCATION_MZONE)",
        "SetCountLimit(1)",
        "EFFECT_FLAG_NO_TURN_RESET",
        "EFFECT_UPDATE_ATTACK",
        "EFFECT_UPDATE_LEVEL",
        "no-turn-reset",
        "c:IsFaceup() and c:IsRelateToEffect(e)",
        "e1:SetValue(600)",
        "e2:SetValue(2)",
        "e1:SetValue(400)",
        "e2:SetValue(1)",
        "currentAttack(card, state)",
        "currentLevel(card, state)",
      ],
    },
  ];
}

function countIgnitionStatKinds(fixtures: IgnitionStatFixture[]): Record<IgnitionStatKind, number> {
  const counts = Object.fromEntries(Object.keys(ignitionStatKindCounts).map((kind) => [kind, 0])) as Record<IgnitionStatKind, number>;
  for (const fixture of fixtures) {
    const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
    for (const snippet of fixture.required) {
      if (!hasCoverageSnippet(text, snippet)) throw new Error(`Missing ${fixture.kind} snippet in ${fixture.file}: ${snippet}`);
    }
    counts[fixture.kind] += 1;
  }
  return counts;
}
