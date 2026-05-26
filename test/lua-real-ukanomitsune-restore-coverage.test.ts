import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Ukanomitsune restore coverage", () => {
  it("owns destroyed SelectEffect both branch, opponent destroy, and damage", () => {
    const file = "test/lua-real-script-ukanomitsune-destroyed-select-effect.test.ts";
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
      'const ukanomitsuneCode = "49451215"',
      "Ukanomitsune-no-Onari",
      "restores destroyed trigger into SelectEffect both branch, opponent destroy, and 1500 damage",
      "Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_LIGHT),2,2,s.matcheck)",
      "e3:SetCategory(CATEGORY_DESTROY+CATEGORY_DAMAGE)",
      "e3:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)",
      "e3:SetCode(EVENT_DESTROYED)",
      "Duel.GetFieldGroupCount(0,LOCATION_FZONE,LOCATION_FZONE)>0",
      "local op=Duel.SelectEffect(tp,",
      "Duel.GetFieldGroup(tp,0,LOCATION_ONFIELD)",
      "Duel.Destroy(sg,REASON_EFFECT)",
      "Duel.Damage(1-tp,1500,REASON_EFFECT)",
      'eventName: "destroyed"',
      'eventName: "sentToGraveyard"',
      'eventName: "breakEffect"',
      'eventName: "damageDealt"',
      "expect(restoredDestroyed.session.state.players[1].lifePoints).toBe(6500)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
