import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Steam Train King restore coverage", () => {
  it("owns graveyard Spell/Trap group banish and count damage", () => {
    const file = "test/lua-real-script-steam-train-king-grave-banish-damage.test.ts";
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
      'const steamTrainCode = "17775525"',
      "Superheavy Samurai Steam Train King",
      "restores graveyard Spell/Trap group banish into count-based effect damage",
      "e1:SetCode(EFFECT_DEFENSE_ATTACK)",
      "e3:SetCategory(CATEGORY_REMOVE+CATEGORY_DAMAGE)",
      "e3:SetType(EFFECT_TYPE_IGNITION)",
      "return c:IsSpellTrap() and c:IsAbleToRemove()",
      "Duel.GetMatchingGroup(s.filter,tp,LOCATION_GRAVE,LOCATION_GRAVE,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,#g*200)",
      "local ct=Duel.Remove(g,POS_FACEUP,REASON_EFFECT)",
      "Duel.Damage(1-tp,ct*200,REASON_EFFECT)",
      'eventName: "banished"',
      'eventName: "damageDealt"',
      "expect(restoredOpen.session.state.players[1].lifePoints).toBe(7600)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
