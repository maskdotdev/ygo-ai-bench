import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Cosmic Fortress Golgar restore coverage", () => {
  it("owns the target return, A-Counter, and destroy-cost fixture", () => {
    const file = "test/lua-real-script-cosmic-fortress-golgar-counter-tohand-destroy.test.ts";
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
      'const golgarCode = "68319538"',
      "Cosmic Fortress Gol'gar",
      "restores Spell/Trap returns into A-Counters, then removes counters to destroy an opponent card",
      "Synchro.AddProcedure(c,aux.FilterSummonCode(652362),1,1,Synchro.NonTunerEx(Card.IsSetCard,SET_ALIEN),1,99)",
      "c:EnableReviveLimit()",
      "e1:SetCategory(CATEGORY_TOHAND+CATEGORY_COUNTER)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,16,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_TOHAND,g,#g,0,0)",
      "local tg=Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)",
      "local rg=tg:Filter(Card.IsRelateToEffect,nil,e)",
      "Duel.SendtoHand(rg,nil,REASON_EFFECT)",
      "local g=Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)",
      "sg:GetFirst():AddCounter(COUNTER_A,1)",
      "Duel.IsCanRemoveCounter(tp,1,1,COUNTER_A,2,REASON_COST)",
      "Duel.RemoveCounter(tp,1,1,COUNTER_A,2,REASON_COST)",
      "Duel.SelectTarget(tp,aux.TRUE,tp,0,LOCATION_ONFIELD,1,1,nil)",
      "Duel.GetFirstTarget()",
      "Duel.Destroy(tc,REASON_EFFECT)",
      "eventName: \"becameTarget\"",
      "eventName: \"sentToHand\"",
      "eventName: \"counterAdded\"",
      "eventName: \"counterRemoved\"",
      "eventName: \"destroyed\"",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
