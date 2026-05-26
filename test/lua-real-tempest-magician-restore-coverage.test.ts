import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Tempest Magician restore coverage", () => {
  it("owns the Synchro Spell Counter cost and damage fixture", () => {
    const file = "test/lua-real-script-tempest-magician-spell-counter-damage.test.ts";
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
      'const tempestCode = "63101919"',
      "Tempest Magician",
      "restores Synchro summon counter trigger, hand-send cost counters, and all Spell Counter damage",
      "c:EnableCounterPermit(COUNTER_SPELL)",
      "Synchro.AddProcedure(c,nil,1,1,Synchro.NonTunerEx(Card.IsRace,RACE_SPELLCASTER),1,99)",
      "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "return e:GetHandler():IsSynchroSummoned()",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,2,0,COUNTER_SPELL)",
      "e:GetHandler():AddCounter(COUNTER_SPELL,1)",
      "Duel.SelectMatchingCard(tp,Card.IsAbleToGraveAsCost,tp,LOCATION_HAND,0,1,63,nil)",
      "Duel.SendtoGrave(g,REASON_COST)",
      "Duel.SelectMatchingCard(tp,Card.IsCanAddCounter,tp,LOCATION_MZONE,0,1,1,nil,COUNTER_SPELL,1)",
      "g:GetFirst():AddCounter(COUNTER_SPELL,1)",
      "Duel.GetCounter(tp,1,1,COUNTER_SPELL)>0",
      "tc:RemoveCounter(tp,COUNTER_SPELL,sct,0)",
      "Duel.SetTargetPlayer(1-tp)",
      "Duel.SetTargetParam(ct*500)",
      "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
      "Duel.Damage(p,d,REASON_EFFECT)",
      "eventName: \"specialSummoned\"",
      "eventName: \"damageDealt\"",
      "lifePoints).toBe(6500)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
