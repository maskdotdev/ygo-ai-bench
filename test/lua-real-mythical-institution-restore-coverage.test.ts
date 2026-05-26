import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Mythical Institution restore coverage", () => {
  it("owns Spell Counter AnnounceNumber search and destroy-replace script shape", () => {
    const file = "test/lua-real-script-mythical-institution-counter-search.test.ts";
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
      'const institutionCode = "94599451"',
      "Mythical Institution",
      "restores AnnounceNumber counter-cost search from Deck",
      "c:EnableCounterPermit(COUNTER_SPELL)",
      "e2:SetCode(EVENT_DESTROYED)",
      "e:GetHandler():AddCounter(COUNTER_SPELL,2)",
      "Duel.AnnounceNumber(tp,table.unpack(lvt))",
      "Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,lv,REASON_COST)",
      "Duel.SendtoHand(g,nil,REASON_EFFECT)",
      "Duel.ConfirmCards(1-tp,g)",
      "e4:SetCode(EFFECT_DESTROY_REPLACE)",
      "Duel.SelectEffectYesNo(tp,e:GetHandler(),96)",
      "e:GetHandler():RemoveCounter(ep,COUNTER_SPELL,1,REASON_EFFECT)",
      "getDuelCardCounter(findCard(restored.session, institution.uid), counterSpell)).toBe(0)",
      'api: "AnnounceNumber"',
      'eventName: "counterRemoved"',
      'eventName: "sentToHandConfirmed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
