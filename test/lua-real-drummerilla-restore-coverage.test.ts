import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const drummerillaKindCounts = { noTributePendulumSummonLevelRegistration: 1 } satisfies Record<DrummerillaKind, number>;
type DrummerillaKind = "noTributePendulumSummonLevelRegistration";

describe("Lua real Drummerilla restore coverage", () => {
  it("keeps Performapal Drummerilla's restored summon-level metadata owned", () => {
    const file = "test/lua-real-script-performapal-drummerilla-summon-level-registration.test.ts";
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
      'const drummerillaCode = "70479321"',
      "Performapal Drummerilla",
      "restores Pendulum helper, no-tribute summon procedure/cost, and attack-announce trigger metadata",
      "Pendulum.AddProcedure(c)",
      "e1:SetCode(EVENT_ATTACK_ANNOUNCE)",
      "Duel.SetTargetCard(tc)",
      "e2:SetCode(EFFECT_SUMMON_PROC)",
      "Duel.GetFieldGroupCount(c:GetControler(),LOCATION_MZONE,LOCATION_MZONE)==0",
      "e3:SetCode(EFFECT_SUMMON_COST)",
      "e1:SetCode(EFFECT_CHANGE_LEVEL)",
      "e1:SetValue(4)",
      "e4:SetRange(LOCATION_MZONE)",
      'triggerEvent: "attackDeclared"',
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Drummerilla fixture kind explicit", () => {
    expect(drummerillaKindCounts).toEqual({ noTributePendulumSummonLevelRegistration: 1 });
  });
});
