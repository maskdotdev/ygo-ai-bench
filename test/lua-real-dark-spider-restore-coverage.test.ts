import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const darkSpiderKindCounts = { targetLevelStatRestore: 1 } satisfies Record<DarkSpiderKind, number>;
type DarkSpiderKind = "targetLevelStatRestore";

describe("Lua real Dark Spider restore coverage", () => {
  it("keeps Dark Spider's targeted Insect Level restore owned", () => {
    const file = "test/lua-real-script-dark-spider-target-level-stat.test.ts";
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
      'const spiderCode = "81759748"',
      "Dark Spider",
      "restores targeted Insect Level boost and excludes non-Insect and Level 0 decoys",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET)",
      "return c:IsFaceup() and c:IsRace(RACE_INSECT) and c:IsLevelAbove(1)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)",
      "e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)",
      "e1:SetCode(EFFECT_UPDATE_LEVEL)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "e1:SetValue(2)",
      "effectUpdateLevel",
      "currentLevel(restored.session.state.cards.find((card) => card.uid === spider.uid), restored.session.state)).toBe(4)",
      "currentLevel(restored.session.state.cards.find((card) => card.uid === insectTarget.uid), restored.session.state)).toBe(3)",
      "currentLevel(restored.session.state.cards.find((card) => card.uid === warriorDecoy.uid), restored.session.state)).toBe(3)",
      "currentLevel(restored.session.state.cards.find((card) => card.uid === levelZero.uid), restored.session.state)).toBe(0)",
      'eventName: "becameTarget"',
      "relatedEffectId: 1",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Dark Spider fixture kind explicit", () => {
    expect(darkSpiderKindCounts).toEqual({ targetLevelStatRestore: 1 });
  });
});
