import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Ally of Justice Decisive Armor restore coverage", () => {
  it("owns its hand destruction LIGHT send and damage branch", () => {
    const file = "test/lua-real-script-aoj-decisive-armor-handes-damage.test.ts";
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
      'const decisiveCode = "9888196"',
      "Ally of Justice Decisive Armor",
      "restores all-hand Graveyard cost into opponent hand confirmation, LIGHT send, and ATK damage",
      "Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),2,99)",
      "return c:IsFaceup() and c:IsAttribute(ATTRIBUTE_LIGHT)",
      "e3:SetCategory(CATEGORY_HANDES+CATEGORY_TOGRAVE+CATEGORY_DAMAGE)",
      "e3:SetType(EFFECT_TYPE_IGNITION)",
      "e3:SetCountLimit(1,0,EFFECT_COUNT_CODE_SINGLE)",
      "Duel.GetFieldGroup(tp,LOCATION_HAND,0)",
      "Duel.SendtoGrave(g,REASON_COST)",
      "Duel.GetFieldGroup(tp,0,LOCATION_HAND)",
      "Duel.ConfirmCards(tp,g)",
      "local sg=g:Filter(Card.IsAttribute,nil,ATTRIBUTE_LIGHT)",
      "Duel.SendtoGrave(sg,REASON_EFFECT)",
      "Duel.Damage(1-tp,atk,REASON_EFFECT)",
      "Duel.ShuffleHand(1-tp)",
      'eventName: "confirmed"',
      'eventName: "sentToGraveyard"',
      'eventName: "damageDealt"',
      "expect(restoredOpen.session.state.players[1].lifePoints).toBe(6300)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
