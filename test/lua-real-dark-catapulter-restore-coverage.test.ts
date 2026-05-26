import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Dark Catapulter restore coverage", () => {
  it("owns the Standby counter and counter-count grave banish destroy fixture shape", () => {
    const file = "test/lua-real-script-dark-catapulter-counter-destroy.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));

    expect(text).toContain("restoreDuelWithLuaScripts");
    expect(text).toContain("restoreComplete");
    expect(text).toContain('incompleteReasons.join("; ")');
    expect(text).toContain("missingRegistryKeys).toEqual([])");
    expect(text).toContain("missingChainLimitRegistryKeys).toEqual([])");
    expect(text).toContain("getLuaRestoreLegalActions");
    expect(text).toContain("getLuaRestoreLegalActionGroups");
    expect(text).toContain("getGroupedDuelLegalActions");
    expect(text).toContain("flatMap((group) => group.actions)");

    const required = [
      'const catapulterCode = "33875961"',
      "Dark Catapulter",
      "restores self Standby counter placement and counter-count grave banish cost into Spell/Trap destruction",
      "c:EnableCounterPermit(0x28)",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetCode(EVENT_PHASE|PHASE_STANDBY)",
      "return Duel.IsTurnPlayer(tp) and e:GetHandler():IsDefensePos()",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0x28)",
      "e:GetHandler():AddCounter(0x28,1)",
      "e2:SetCategory(CATEGORY_DESTROY)",
      "e2:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "Duel.IsExistingMatchingCard(Card.IsAbleToRemove,tp,LOCATION_GRAVE,0,ct,nil)",
      "Duel.SelectMatchingCard(tp,Card.IsAbleToRemove,tp,LOCATION_GRAVE,0,ct,ct,nil)",
      "Duel.Remove(g,POS_FACEUP,REASON_COST)",
      "return c:IsSpellTrap()",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,ct,ct,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,ct,0,0)",
      "Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)",
      "Duel.Destroy(g,REASON_EFFECT)",
      "e:GetHandler():RemoveCounter(tp,0x28,ct,REASON_EFFECT)",
      'eventName: "phaseStandby"',
      'eventName: "banished"',
      'eventName: "becameTarget"',
      'eventName: "destroyed"',
      'eventName: "counterRemoved"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
