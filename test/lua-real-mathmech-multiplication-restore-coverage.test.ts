import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const mathmechMultiplicationKindCounts = { levelChangeToGraveFinalAttackRestore: 1 } satisfies Record<MathmechMultiplicationKind, number>;
type MathmechMultiplicationKind = "levelChangeToGraveFinalAttackRestore";

describe("Lua real Mathmech Multiplication restore coverage", () => {
  it("keeps Mathmech Multiplication's level-change and to-Grave stat trigger owned", () => {
    const file = "test/lua-real-script-mathmech-multiplication-level-tograve-stat.test.ts";
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
      'const multiplicationCode = "52354896"',
      "Mathmech Multiplication",
      "restores targeted level change and delayed to-Grave final ATK doubling",
      "return c:IsFaceup() and c:GetLevel()==4 and c:IsRace(RACE_CYBERSE)",
      "Duel.SelectTarget(tp,s.lvfilter,tp,LOCATION_MZONE,0,1,1,nil)",
      "e1:SetCode(EFFECT_CHANGE_LEVEL)",
      "e1:SetValue(8)",
      "e2:SetCode(EVENT_TO_GRAVE)",
      "return c:IsFaceup() and c:IsRace(RACE_CYBERSE) and c:GetSequence()>4",
      "Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetValue(tc:GetAttack()*2)",
      "currentLevel(restoredLevel.session.state.cards.find((card) => card.uid === multiplication.uid), restoredLevel.session.state)).toBe(8)",
      "code: effectChangeLevel",
      'eventName === "becameTarget"',
      'action.type === "activateTrigger"',
      'eventName: "sentToGraveyard"',
      "currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === extraCyberse.uid), restoredTrigger.session.state)).toBe(4200)",
      "code: effectSetAttackFinal",
      "value: 4200",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Mathmech Multiplication fixture kind explicit", () => {
    expect(mathmechMultiplicationKindCounts).toEqual({ levelChangeToGraveFinalAttackRestore: 1 });
  });
});
