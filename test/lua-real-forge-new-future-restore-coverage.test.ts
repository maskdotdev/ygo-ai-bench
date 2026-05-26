import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Forge a New Future restore coverage", () => {
  it("owns Link-4 summon trigger into announce-card disable locks", () => {
    const file = "test/lua-real-script-forge-new-future-announce-disable.test.ts";
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
      'const forgeCode = "27104921"',
      "Forge a New Future",
      "restores Link-4 summon trigger into counter placement and declared-card disable locks",
      "c:EnableCounterPermit(0x20b)",
      "c:SetCounterLimit(0x20b,3)",
      "e0:SetCode(EVENT_FREE_CHAIN)",
      "e1:SetCategory(CATEGORY_COUNTER+CATEGORY_SPECIAL_SUMMON+CATEGORY_TOGRAVE)",
      "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "return c:IsType(TYPE_LINK) and c:IsLinkSummoned() and c:IsLink(4)",
      "Duel.SetPossibleOperationInfo(0,CATEGORY_TOGRAVE,e:GetHandler(),1,tp,0)",
      "Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_GRAVE|LOCATION_EXTRA)",
      "Duel.SelectYesNo(tp,aux.Stringid(id,1))",
      "Duel.AnnounceCard(tp)",
      "Duel.BreakEffect()",
      "e1:SetCode(EFFECT_DISABLE)",
      "e2:SetCode(EVENT_CHAIN_SOLVING)",
      "Duel.NegateEffect(ev)",
      "e3:SetCode(EFFECT_DISABLE_TRAPMONSTER)",
      "getDuelCardCounter(findCard(restoredTrigger.session, forge.uid), counterForge)).toBe(0)",
      'api: "AnnounceCard"',
      'eventName: "counterAdded"',
      'eventName: "breakEffect"',
      "effectDisableTrapMonster",
      "eventChainSolving",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
