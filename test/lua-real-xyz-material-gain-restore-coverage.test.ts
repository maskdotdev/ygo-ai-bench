import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const xyzMaterialGainFixtureCount = 2;
const xyzMaterialGainKindCounts = {
  synchroMaterialTargetAtkReduction: 1,
  xyzMaterialGrantsAttackAndType: 1,
} satisfies Record<XyzMaterialGainKind, number>;

type XyzMaterialGainKind = "synchroMaterialTargetAtkReduction" | "xyzMaterialGrantsAttackAndType";

describe("Lua real Xyz material gain restore coverage", () => {
  it("requires Xyz material-gain fixtures to assert clean Lua registry restore and restored legal-action parity", () => {
    const files = xyzMaterialGainFixtureFiles();
    expect(files).toHaveLength(xyzMaterialGainFixtureCount);

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
          || !text.includes("applyLuaRestoreResponse")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps Xyz material-gain behavior variants explicit", () => {
    expect(countXyzMaterialGainKinds(xyzMaterialGainFixtures())).toEqual(xyzMaterialGainKindCounts);

    const weak = xyzMaterialGainFixtures()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function xyzMaterialGainFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-quick-span-knight-synchro-material-atk.test.ts",
      required: [
        "Lua real script Quick-Span Knight Synchro material ATK target",
        'const quickSpanCode = "11287364"',
        "e1:SetCode(EVENT_BE_MATERIAL)",
        "r==REASON_SYNCHRO",
        "Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)",
        "local tc=Duel.GetFirstTarget()",
        "synchroSummonDuelCard(restoredOpen.session.state",
        "currentAttack(restoredResolved.session.state.cards.find",
      ],
    },
    {
      file: "test/lua-real-script-xyz-material-gained-attack-type.test.ts",
      required: [
        "Lua real script Xyz material gained attack and type",
        'const extraSwordCode = "34143852"',
        'const trolleyOlleyCode = "7080743"',
        "eventHistory",
        "pendingTriggers",
        "operationInfos",
      ],
    },
  ];
}

function xyzMaterialGainFixtures(): Array<{ file: string; kind: XyzMaterialGainKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-quick-span-knight-synchro-material-atk.test.ts",
      kind: "synchroMaterialTargetAtkReduction",
      required: [
        "restores its Synchro material trigger, opponent target prompt, and ATK reduction",
        "e1:SetCode(EVENT_BE_MATERIAL)",
        "return e:GetHandler():IsLocation(LOCATION_GRAVE) and r==REASON_SYNCHRO",
        "Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)",
        "local tc=Duel.GetFirstTarget()",
        "e1:SetCode(EFFECT_UPDATE_ATTACK)",
        "e1:SetReset(RESET_EVENT|RESETS_STANDARD)",
        "e1:SetValue(-500)",
        "eventBeMaterial = 1108",
        "eventReason: duelReason.synchro",
        "eventReasonCardUid: synchro.uid",
        "currentAttack(restoredTrigger.session.state.cards.find",
        "currentAttack(restoredResolved.session.state.cards.find",
      ],
    },
    {
      file: "test/lua-real-script-xyz-material-gained-attack-type.test.ts",
      kind: "xyzMaterialGrantsAttackAndType",
      required: [
        "restores official REASON_XYZ material grants into Xyz-summon trigger ATK boosts",
        "e1:SetCode(EVENT_BE_MATERIAL)",
        "return r==REASON_XYZ",
        "local rc=c:GetReasonCard()",
        "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)",
        "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "return e:GetHandler():IsXyzSummoned()",
        "e2:SetCode(EFFECT_ADD_TYPE)",
        "e2:SetValue(TYPE_EFFECT)",
        "e1:SetCode(EFFECT_UPDATE_ATTACK)",
        "e1:SetValue(1000)",
        "e1:SetValue(800)",
        "effectAddType = 115",
        "effectUpdateAttack = 100",
        "eventBeMaterial = 1108",
        "eventSpecialSummonSuccess = 1102",
        "cardTypeFlags(restoredNormalXyz, restoredResolved.session.state) & typeEffect",
        "currentAttack(restoredNormalXyz, restoredResolved.session.state)).toBe(baseAttack + testCase.boost)",
      ],
    },
  ];
}

function countXyzMaterialGainKinds(fixtures: Array<{ kind: XyzMaterialGainKind }>): Record<XyzMaterialGainKind, number> {
  return fixtures.reduce<Record<XyzMaterialGainKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      synchroMaterialTargetAtkReduction: 0,
      xyzMaterialGrantsAttackAndType: 0,
    },
  );
}
