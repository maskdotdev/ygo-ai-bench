import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Destiny HERO - Dread Servant restore coverage", () => {
  it("owns summon Clock Counter placement and battle-destroyed Spell/Trap destruction", () => {
    const file = "test/lua-real-script-destiny-hero-dread-servant-counter-destroy.test.ts";
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
      'const dreadServantCode = "36625827"',
      "Destiny HERO - Dread Servant",
      "restores summon Clock Counter placement and battle-destroyed Spell/Trap destruction",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetCode(EVENT_SUMMON_SUCCESS)",
      "Duel.GetFieldCard(tp,LOCATION_FZONE,0)",
      "tc:AddCounter(0x1b,1)",
      "Duel.GetFieldCard(1-tp,LOCATION_FZONE,0)",
      "e2:SetCategory(CATEGORY_DESTROY)",
      "e2:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "e2:SetCode(EVENT_BATTLE_DESTROYED)",
      "return e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():IsReason(REASON_BATTLE)",
      "Duel.IsExistingTarget(Card.IsSpellTrap,tp,LOCATION_ONFIELD,0,1,nil)",
      "Duel.SelectTarget(tp,Card.IsSpellTrap,tp,LOCATION_ONFIELD,0,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_DESTROY,g,#g,0,0)",
      "Duel.GetFirstTarget()",
      "Duel.Destroy(tc,REASON_EFFECT)",
      'eventName: "normalSummoned"',
      'eventName: "counterAdded"',
      'eventName: "battleDestroyed"',
      'eventName: "becameTarget"',
      'eventName: "destroyed"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
