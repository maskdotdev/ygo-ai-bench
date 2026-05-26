import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const gigaBrilliantKindCounts = { detachGroupAttackStatRestore: 1 } satisfies Record<GigaBrilliantKind, number>;
type GigaBrilliantKind = "detachGroupAttackStatRestore";

describe("Lua real Number 20 Giga-Brilliant restore coverage", () => {
  it("keeps Giga-Brilliant's detach cost and group attack restore owned", () => {
    const file = "test/lua-real-script-giga-brilliant-detach-group-attack-stat.test.ts";
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
      'const gigaBrilliantCode = "47805931"',
      "Number 20: Giga-Brilliant",
      "restores Xyz metadata and detach cost into controller face-up monster ATK boosts",
      "Xyz.AddProcedure(c,nil,3,2)",
      "c:EnableReviveLimit()",
      "e1:SetCost(Cost.DetachFromSelf(1))",
      "Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,0,nil)",
      "for tc in aux.Next(g) do",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)",
      "e1:SetValue(300)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD)",
      "reasonEffectId: 2",
      "eventReasonEffectId: 2",
      'eventName: "detachedMaterial"',
      "currentAttack(restored.session.state.cards.find((card) => card.uid === ally.uid), restored.session.state)).toBe(1800)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Giga-Brilliant fixture kind explicit", () => {
    expect(gigaBrilliantKindCounts).toEqual({ detachGroupAttackStatRestore: 1 });
  });
});
