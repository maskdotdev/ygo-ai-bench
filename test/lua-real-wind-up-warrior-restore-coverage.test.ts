import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const windUpWarriorKindCounts = { targetAttackLevelStatRestore: 1 } satisfies Record<WindUpWarriorKind, number>;
type WindUpWarriorKind = "targetAttackLevelStatRestore";

describe("Lua real Wind-Up Warrior restore coverage", () => {
  it("keeps Wind-Up Warrior's targeted ATK and Level restore owned", () => {
    const file = "test/lua-real-script-wind-up-warrior-target-attack-level-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));

    expect(text.includes("restoreDuelWithLuaScripts")).toBe(true);
    expect(text.includes("restoreComplete")).toBe(true);
    expect(text.includes('incompleteReasons.join("; ")')).toBe(true);
    expect(text.includes("missingRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("missingChainLimitRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("getLuaRestoreLegalActions")).toBe(true);
    expect(text.includes("getLuaRestoreLegalActionGroups")).toBe(true);
    expect(text.includes("getGroupedDuelLegalActions")).toBe(true);
    for (const snippet of [
      'const warriorCode = "53540729"',
      "Wind-Up Warrior",
      "restores no-turn-reset Wind-Up target ATK and Level boost",
      "e1:SetProperty(EFFECT_FLAG_NO_TURN_RESET+EFFECT_FLAG_CARD_TARGET)",
      "s.listed_series={SET_WIND_UP}",
      "return c:IsFaceup() and c:IsSetCard(SET_WIND_UP) and c:IsLevelAbove(1)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)",
      "e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "e1:SetValue(600)",
      "e2:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)",
      "e2:SetCode(EFFECT_UPDATE_LEVEL)",
      "e2:SetReset(RESETS_STANDARD_PHASE_END)",
      "e2:SetValue(1)",
      "effectUpdateAttack",
      "effectUpdateLevel",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(1800)",
      "currentLevel(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(5)",
      'eventName: "becameTarget"',
      "relatedEffectId: 1",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Wind-Up Warrior fixture kind explicit", () => {
    expect(windUpWarriorKindCounts).toEqual({ targetAttackLevelStatRestore: 1 });
  });
});
