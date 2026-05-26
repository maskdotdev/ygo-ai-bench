import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const twilightNinjaKagenKindCounts = { pzoneSummonLimitAndAttackStatMetadata: 1 } satisfies Record<TwilightNinjaKagenKind, number>;
type TwilightNinjaKagenKind = "pzoneSummonLimitAndAttackStatMetadata";

describe("Lua real Twilight Ninja Kagen restore coverage", () => {
  it("keeps Twilight Ninja Kagen's restored PZone summon-limit and stat metadata owned", () => {
    const file = "test/lua-real-script-twilight-ninja-kagen-pzone-stat.test.ts";
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
      'const kagenCode = "6830480"',
      "Twilight Ninja Kagen",
      "restores its Pendulum-zone summon limit and attack-announce stat trigger metadata",
      "Pendulum.AddProcedure(c)",
      "e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)",
      "e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CANNOT_NEGATE)",
      "e1:SetTargetRange(1,0)",
      "return not c:IsSetCard(SET_NINJA) and (sumtp&SUMMON_TYPE_PENDULUM)==SUMMON_TYPE_PENDULUM",
      "e2:SetCode(EVENT_ATTACK_ANNOUNCE)",
      "Duel.GetAttacker()",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(1000)",
      "e3:SetCost(Cost.SelfTribute)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)",
      "e1:SetValue(800)",
      'triggerEvent: "attackDeclared"',
      "targetRange: [1, 0]",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Twilight Ninja Kagen fixture kind explicit", () => {
    expect(twilightNinjaKagenKindCounts).toEqual({ pzoneSummonLimitAndAttackStatMetadata: 1 });
  });
});
