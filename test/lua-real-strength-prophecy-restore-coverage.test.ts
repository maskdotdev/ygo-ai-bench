import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const strengthProphecyKindCounts = { graveToDeckAttackLevelStatRestore: 1 } satisfies Record<StrengthProphecyKind, number>;
type StrengthProphecyKind = "graveToDeckAttackLevelStatRestore";

describe("Lua real Strength of Prophecy restore coverage", () => {
  it("keeps Strength of Prophecy's Spellbook cost and stat restore owned", () => {
    const file = "test/lua-real-script-strength-prophecy-grave-todeck-attack-level-stat.test.ts";
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
      'const strengthCode = "13002461"',
      "Strength of Prophecy",
      "restores Spellbook grave-to-Deck cost into Spellcaster ATK and Level boost",
      "s.listed_series={SET_SPELLBOOK}",
      "return c:IsSetCard(SET_SPELLBOOK) and c:IsSpell() and c:IsAbleToDeckAsCost()",
      "Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_GRAVE,0,1,1,e:GetHandler())",
      "Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_COST)",
      "return c:IsFaceup() and c:IsRace(RACE_SPELLCASTER) and c:IsLevelAbove(1)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD)",
      "e1:SetValue(500)",
      "e2:SetCode(EFFECT_UPDATE_LEVEL)",
      "e2:SetValue(1)",
      "reasonEffectId: 1",
      "effectUpdateAttack",
      "effectUpdateLevel",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === strength.uid), restored.session.state)).toBe(2000)",
      "currentLevel(restored.session.state.cards.find((card) => card.uid === strength.uid), restored.session.state)).toBe(5)",
      'eventName: "sentToDeck"',
      'eventName: "becameTarget"',
      "relatedEffectId: 1",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Strength of Prophecy fixture kind explicit", () => {
    expect(strengthProphecyKindCounts).toEqual({ graveToDeckAttackLevelStatRestore: 1 });
  });
});
