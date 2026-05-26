import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Thorn Fangs restore coverage", () => {
  it("owns Starving Venom target destroy, optional hand discard, and damage", () => {
    const file = "test/lua-real-script-thorn-fangs-destroy-discard-damage.test.ts";
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
      'const thornCode = "72374522"',
      "Thorn Fangs of Violet Poison",
      "restores Starving Venom target into cannot-attack, lower-ATK destroy, whole-hand discard, and damage",
      "CARD_STARVING_VENOM_FUSION_DRAGON=41209827",
      "e1:SetCategory(CATEGORY_DESTROY+CATEGORY_HANDES+CATEGORY_DAMAGE)",
      "e1:SetType(EFFECT_TYPE_ACTIVATE)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "Duel.SelectTarget(tp,s.tgfilter,tp,LOCATION_MZONE,0,1,1,nil,tp)",
      "e1:SetCode(EFFECT_CANNOT_ATTACK)",
      "Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsAttackBelow,tc:GetAttack()-1),tp,0,LOCATION_MZONE,nil)",
      "Duel.Destroy(g,REASON_EFFECT)",
      "Duel.SelectYesNo(tp,aux.Stringid(id,1))",
      "Duel.GetOperatedGroup():Match(aux.NOT(Card.IsTextAttack),nil,-2):GetSum(Card.GetTextAttack)",
      "Duel.SendtoGrave(hg,REASON_EFFECT|REASON_DISCARD)",
      "Duel.Damage(1-tp,dam,REASON_EFFECT)",
      'eventName: "destroyed"',
      'eventName: "sentToGraveyard"',
      'eventName: "damageDealt"',
      "expect(restoredOpen.session.state.players[1].lifePoints).toBe(6800)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
