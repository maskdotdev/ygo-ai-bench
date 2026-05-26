import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Cloudian Nimbusman restore coverage", () => {
  it("owns tribute material WATER counting into Fog Counters and ATK gain", () => {
    const file = "test/lua-real-script-cloudian-nimbusman-tribute-counter-stat.test.ts";
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
      'const nimbusCode = "20003527"',
      "Cloudian - Nimbusman",
      "restores tribute material WATER counting into Fog Counters and global ATK gain",
      "e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
      "e2:SetCode(EFFECT_SELF_DESTROY)",
      "return e:GetHandler():IsPosition(POS_FACEUP_DEFENSE)",
      "aux.AddNormalSummonProcedure(c,true,true,1,99,SUMMON_TYPE_TRIBUTE,aux.Stringid(id,0),s.cfilter)",
      "e4:SetCode(EFFECT_MATERIAL_CHECK)",
      "local g=c:GetMaterial()",
      "e:SetLabel(g:FilterCount(Card.IsAttribute,nil,ATTRIBUTE_WATER))",
      "e5:SetCode(EVENT_SUMMON_SUCCESS)",
      "return e:GetHandler():IsTributeSummoned()",
      "e:GetHandler():AddCounter(COUNTER_NEED_ENABLE+COUNTER_FOG,e:GetLabelObject():GetLabel())",
      "e6:SetCode(EFFECT_UPDATE_ATTACK)",
      "return Duel.GetCounter(0,1,1,COUNTER_FOG)*500",
      'eventName: "normalSummoned"',
      'eventName: "counterAdded"',
      "currentAttack(findCard(restoredAfter.session, nimbus.uid), restoredAfter.session.state)).toBe((nimbus.data.attack ?? 0) + 500)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
