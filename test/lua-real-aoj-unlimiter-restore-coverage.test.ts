import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const aojUnlimiterKindCounts = { selfTributeTargetFinalStatRestore: 1 } satisfies Record<AojUnlimiterKind, number>;
type AojUnlimiterKind = "selfTributeTargetFinalStatRestore";

describe("Lua real Ally of Justice Unlimiter restore coverage", () => {
  it("keeps AOJ Unlimiter's self-tribute target final-stat restore owned", () => {
    const file = "test/lua-real-script-aoj-unlimiter-self-tribute-final-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));

    expect(text.includes("restoreDuelWithLuaScripts")).toBe(true);
    expect(text.includes("restoreComplete")).toBe(true);
    expect(text.includes('incompleteReasons.join("; ")')).toBe(true);
    expect(text.includes("missingRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("missingChainLimitRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("getLuaRestoreLegalActions")).toBe(true);
    expect(text.includes("getLuaRestoreLegalActionGroups")).toBe(true);
    expect(text.includes("getGroupedDuelLegalActions")).toBe(true);
    for (const snippet of [
      'const unlimiterCode = "82377606"',
      "Ally of Justice Unlimiter",
      "restores SelfTribute cost into targeted Ally of Justice printed ATK doubling",
      "e1:SetCost(Cost.SelfTribute)",
      "s.listed_series={SET_ALLY_OF_JUSTICE}",
      "Duel.IsExistingTarget(aux.FaceupFilter(Card.IsSetCard,SET_ALLY_OF_JUSTICE),tp,LOCATION_MZONE,0,1,e:GetHandler())",
      "Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_ALLY_OF_JUSTICE),tp,LOCATION_MZONE,0,1,1,nil)",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetValue(tc:GetTextAttack()*2)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "reasonEffectId: 1",
      "eventReasonEffectId: 1",
      'eventName: "released"',
      'eventName: "sentToGraveyard"',
      "currentAttack(restored.session.state.cards.find((card) => card.uid === allyTarget.uid), restored.session.state)).toBe(3200)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps AOJ Unlimiter fixture kind explicit", () => {
    expect(aojUnlimiterKindCounts).toEqual({ selfTributeTargetFinalStatRestore: 1 });
  });
});
