import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const splendidRoseKindCounts = { banishFinalAttackAndExtraAttack: 1 } satisfies Record<SplendidRoseKind, number>;
type SplendidRoseKind = "banishFinalAttackAndExtraAttack";

describe("Lua real Splendid Rose restore coverage", () => {
  it("keeps Splendid Rose's Plant banish final ATK and extra attack restore owned", () => {
    const file = "test/lua-real-script-splendid-rose-banish-final-extra-attack.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const roseCode = "4290468"',
      "Splendid Rose",
      "Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)",
      "return c:IsRace(RACE_PLANT) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)",
      "Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetValue(tc:GetAttack()/2)",
      "return Duel.IsBattlePhase() and e:GetHandler():GetAttackedGroupCount()~=0",
      "Duel.GetAttacker()==nil and Duel.GetCurrentChain()==0",
      "Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,e:GetHandler())",
      "e2:SetCode(EFFECT_EXTRA_ATTACK)",
      "reasonEffectId: 3",
      "reasonEffectId: 4",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === target.uid), restored.session.state)).toBe(1200)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === rose.uid), restored.session.state)).toBe(1100)",
      "effectExtraAttack",
      "type: \"declareAttack\"",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Splendid Rose fixture kinds explicit", () => {
    expect(splendidRoseKindCounts).toEqual({ banishFinalAttackAndExtraAttack: 1 });
  });
});

function expectCleanRestoreEvidence(text: string): void {
  expect(text.includes("restoreDuelWithLuaScripts")).toBe(true);
  expect(text.includes("restoreComplete")).toBe(true);
  expect(text.includes('incompleteReasons.join("; ")')).toBe(true);
  expect(text.includes("missingRegistryKeys).toEqual([])")).toBe(true);
  expect(text.includes("missingChainLimitRegistryKeys).toEqual([])")).toBe(true);
  expect(text.includes("getLuaRestoreLegalActions")).toBe(true);
  expect(text.includes("getLuaRestoreLegalActionGroups")).toBe(true);
  expect(text.includes("getGroupedDuelLegalActions")).toBe(true);
}
