import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const powerInjectorKindCounts = { lpPsychicGroupAttackStatRestore: 1 } satisfies Record<PowerInjectorKind, number>;
type PowerInjectorKind = "lpPsychicGroupAttackStatRestore";

describe("Lua real Power Injector restore coverage", () => {
  it("keeps Power Injector's LP cost and Psychic group attack restore owned", () => {
    const file = "test/lua-real-script-power-injector-lp-psychic-group-stat.test.ts";
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
      'const injectorCode = "89547299"',
      "Power Injector",
      "restores LP cost into all face-up Psychic monster ATK boosts",
      "e1:SetCost(Cost.PayLP(600))",
      "Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsRace,RACE_PSYCHIC),tp,LOCATION_MZONE,LOCATION_MZONE,1,nil)",
      "Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsRace,RACE_PSYCHIC),tp,LOCATION_MZONE,LOCATION_MZONE,nil)",
      "for tc in aux.Next(g) do",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)",
      "e1:SetValue(500)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      'eventName: "lifePointCostPaid"',
      "eventReasonEffectId: 1",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === opponentPsychic.uid), restored.session.state)).toBe(2100)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Power Injector fixture kind explicit", () => {
    expect(powerInjectorKindCounts).toEqual({ lpPsychicGroupAttackStatRestore: 1 });
  });
});
