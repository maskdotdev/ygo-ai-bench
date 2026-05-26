import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Cloudian Aerosol restore coverage", () => {
  it("owns grave Cloudian banish cost into Deck Special Summon", () => {
    const file = "test/lua-real-script-cloudian-aerosol-grave-banish-summon.test.ts";
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
      'const aerosolCode = "88210105"',
      "Cloudian Aerosol",
      "restores grave cost banish into Deck Cloudian Special Summon",
      "Duel.SelectMatchingCard(tp,s.ctcfilter,tp,LOCATION_HAND,0,1,1,nil)",
      "Duel.SendtoGrave(dc,REASON_COST|REASON_DISCARD)",
      "Duel.IsExistingTarget(s.cttfilter,tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)",
      "local tc=Duel.GetFirstTarget()",
      "tc:AddCounter(COUNTER_FOG,tc:GetLevel())",
      "Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_GRAVE,0,1,nil)",
      "Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_GRAVE,0,1,1,nil)",
      "g:AddCard(e:GetHandler())",
      "Duel.Remove(g,POS_FACEUP,REASON_COST)",
      "Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_DECK,0,1,nil,e,tp)",
      "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil,e,tp)",
      "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
      'eventName: "banished"',
      'eventName: "specialSummoned"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
