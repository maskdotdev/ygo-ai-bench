import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const skillGainerKindCounts = { detachCopyCodeRestore: 1 } satisfies Record<SkillGainerKind, number>;
type SkillGainerKind = "detachCopyCodeRestore";

describe("Lua real One-Eyed Skill Gainer restore coverage", () => {
  it("keeps One-Eyed Skill Gainer's detach copy-code restore owned", () => {
    const file = "test/lua-real-script-one-eyed-skill-gainer-detach-copy-code.test.ts";
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
      'const skillGainerCode = "75620895"',
      "One-Eyed Skill Gainer",
      "restores targeted Xyz copy-code effect after detaching overlay cost",
      "Xyz.AddProcedure(c,nil,4,3)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_NO_TURN_RESET)",
      "e1:SetCost(Cost.DetachFromSelf(1))",
      "return c:IsFaceup() and c:IsType(TYPE_XYZ)",
      "Duel.SelectTarget(tp,s.filter,tp,0,LOCATION_MZONE,1,1,nil)",
      "local code=tc:GetOriginalCode()",
      "e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD)",
      "e1:SetCode(EFFECT_CHANGE_CODE)",
      "e1:SetValue(code)",
      "c:CopyEffect(code,RESET_EVENT|RESETS_STANDARD,1)",
      "reasonEffectId: 2",
      "effectChangeCode",
      "value: Number(targetXyzCode)",
      'eventName: "detachedMaterial"',
      'eventName: "becameTarget"',
      "eventReasonEffectId: 2",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps One-Eyed Skill Gainer fixture kind explicit", () => {
    expect(skillGainerKindCounts).toEqual({ detachCopyCodeRestore: 1 });
  });
});
