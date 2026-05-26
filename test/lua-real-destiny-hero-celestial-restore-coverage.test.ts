import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Destiny HERO Celestial restore coverage", () => {
  it("owns its empty-hand grave draw and self plus Destiny HERO banish cost", () => {
    const file = "test/lua-real-script-destiny-hero-celestial-grave-draw.test.ts";
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
      'const celestialCode = "63362460"',
      "Destiny HERO - Celestial",
      "restores empty-hand grave ignition into self plus Destiny HERO banish cost and target-param draw",
      "s.listed_series={SET_DESTINY_HERO}",
      "e2:SetCategory(CATEGORY_DRAW)",
      "e2:SetType(EFFECT_TYPE_IGNITION)",
      "e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)",
      "e2:SetRange(LOCATION_GRAVE)",
      "return Duel.GetFieldGroupCount(tp,LOCATION_HAND,0)==0 and aux.exccon(e)",
      "return c:IsSetCard(SET_DESTINY_HERO) and c:IsMonster() and c:IsAbleToRemoveAsCost()",
      "aux.bfgcost(e,tp,eg,ep,ev,re,r,rp,0)",
      "Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_GRAVE,0,1,1,c)",
      "g:AddCard(c)",
      "Duel.Remove(g,POS_FACEUP,REASON_COST)",
      "Duel.SetTargetPlayer(tp)",
      "Duel.SetTargetParam(2)",
      "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
      "Duel.Draw(p,d,REASON_EFFECT)",
      'eventName: "banished"',
      'eventName: "cardsDrawn"',
      "eventReason: duelReason.cost",
      "eventReason: duelReason.effect",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
