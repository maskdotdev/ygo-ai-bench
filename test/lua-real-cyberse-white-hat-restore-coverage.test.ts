import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const cyberseWhiteHatKindCounts = { sameRaceMaterialProcedure: 1 } satisfies Record<CyberseWhiteHatKind, number>;
type CyberseWhiteHatKind = "sameRaceMaterialProcedure";

describe("Lua real Cyberse White Hat restore coverage", () => {
  it("keeps Cyberse White Hat's material procedure metadata owned", () => {
    const file = "test/lua-real-script-cyberse-white-hat-material-procedure.test.ts";
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
      'const whiteHatCode = "46104361"',
      "Cyberse White Hat",
      "restores same-race hand procedure and delayed BE_MATERIAL ATK trigger metadata",
      "e1:SetCode(EFFECT_SPSUMMON_PROC)",
      "Duel.IsExistingMatchingCard(s.filter,c:GetControler(),LOCATION_MZONE,0,1,nil,c:GetControler())",
      "e2:SetCode(EVENT_BE_MATERIAL)",
      "e2:SetProperty(EFFECT_FLAG_DELAY)",
      "return c:IsLocation(LOCATION_GRAVE) and r==REASON_LINK",
      "Duel.GetMatchingGroup(Card.IsFaceup,tp,0,LOCATION_MZONE,nil)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(-1000)",
      'triggerEvent: "usedAsMaterial"',
      "Special Summon Cyberse White Hat",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Cyberse White Hat fixture kind explicit", () => {
    expect(cyberseWhiteHatKindCounts).toEqual({ sameRaceMaterialProcedure: 1 });
  });
});
