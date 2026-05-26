import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

type PerformapalBalladKind = "pzoneBattleStartAndBattriggerStatMetadata";

const performapalBalladKindCounts = {
  pzoneBattleStartAndBattriggerStatMetadata: 1,
} satisfies Record<PerformapalBalladKind, number>;

describe("Lua real script Performapal Ballad restore coverage", () => {
  it("covers its PZone battle-start and monster-zone battled stat metadata fixture", () => {
    const fixture = "test/lua-real-script-performapal-ballad-battle-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, fixture), "utf8"));

    expect(fs.existsSync(path.join(root, fixture))).toBe(true);
    expect(text).toContain("restoreDuelWithLuaScripts");
    expect(text).toContain("restoreComplete");
    expect(text).toContain('incompleteReasons.join("; ")');
    expect(text).toContain("missingRegistryKeys).toEqual([])");
    expect(text).toContain("missingChainLimitRegistryKeys).toEqual([])");
    expect(text).toContain("getLuaRestoreLegalActions");
    expect(text).toContain("getLuaRestoreLegalActionGroups");
    expect(text).toContain("getGroupedDuelLegalActions");

    for (const snippet of [
      'const balladCode = "66768175"',
      "Performapal Ballad",
      "restores its PZone battle-start and monster-zone battled attack reduction triggers",
      "Pendulum.AddProcedure(c)",
      "e1:SetCode(EVENT_BATTLE_START)",
      "e1:SetRange(LOCATION_PZONE)",
      "tc:IsSetCard(SET_PERFORMAPAL)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(-600)",
      "e2:SetCode(EVENT_BATTLED)",
      "e2:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)",
      "local atk=math.max(0,a:GetAttack())",
      'triggerEvent: "battleStarted"',
      'triggerEvent: "afterDamageCalculation"',
    ]) {
      expect(hasCoverageSnippet(text, snippet), snippet).toBe(true);
    }
  });

  it("keeps Performapal Ballad fixture kind explicit", () => {
    expect(performapalBalladKindCounts).toEqual({
      pzoneBattleStartAndBattriggerStatMetadata: 1,
    });
  });
});
