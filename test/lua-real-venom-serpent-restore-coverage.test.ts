import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real Venom Serpent restore coverage", () => {
  it("owns opponent Venom Counter targeting and the zero-ATK custom event", () => {
    const file = "test/lua-real-script-venom-serpent-counter-custom-event.test.ts";
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
      'const serpentCode = "36278828"',
      "Venom Serpent",
      "restores opponent Venom Counter targeting and zero-ATK custom event",
      "s.counter_place_list={COUNTER_VENOM}",
      "chkc:IsControler(1-tp) and chkc:IsCanAddCounter(COUNTER_VENOM,1)",
      "Duel.IsExistingTarget(Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,nil,COUNTER_VENOM,1)",
      "Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_VENOM,1)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0)",
      "local atk=tc:GetAttack()",
      "tc:AddCounter(COUNTER_VENOM,1)",
      "if atk>0 and tc:GetAttack()==0 then",
      "Duel.RaiseEvent(tc,EVENT_CUSTOM+54306223,e,0,0,0,0)",
      "c:EnableCounterPermit(COUNTER_VENOM,LOCATION_MZONE)",
      'eventName: "becameTarget"',
      'eventName: "counterAdded"',
      'eventName: "customEvent"',
      "currentAttack(findCard(restoredResolved.session, target.uid), restoredResolved.session.state)).toBe(0)",
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
