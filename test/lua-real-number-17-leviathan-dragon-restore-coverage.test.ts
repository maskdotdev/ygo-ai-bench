import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const leviathanDragonKindCounts = { detachStatDirectLockRestore: 1 } satisfies Record<LeviathanDragonKind, number>;
type LeviathanDragonKind = "detachStatDirectLockRestore";

describe("Lua real Number 17 Leviathan Dragon restore coverage", () => {
  it("keeps Number 17's detach ATK gain and direct-attack lock restore owned", () => {
    const file = "test/lua-real-script-number-17-leviathan-dragon-detach-stat-direct-lock.test.ts";
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
      'const leviathanCode = "69610924"',
      "Number 17: Leviathan Dragon",
      "restores detach cost into copy-inherit ATK gain and conditional direct-attack lock",
      "Xyz.AddProcedure(c,nil,3,2)",
      "s.xyz_number=17",
      "e1:SetCost(Cost.DetachFromSelf(1))",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)",
      "e1:SetValue(500)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)",
      "e2:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)",
      "return e:GetHandler():GetOverlayCount()==0",
      "reasonEffectId: 2",
      "effectCannotDirectAttack",
      "effectUpdateAttack",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === leviathan.uid), restored.session.state)).toBe(2500)",
      "overlayUids).toEqual([materialB.uid])",
      'eventName: "detachedMaterial"',
      "eventReasonEffectId: 2",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Number 17 Leviathan Dragon fixture kind explicit", () => {
    expect(leviathanDragonKindCounts).toEqual({ detachStatDirectLockRestore: 1 });
  });
});
