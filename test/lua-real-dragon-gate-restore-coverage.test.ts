import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const dragonGateKindCounts = { mixedOverlayTypeAttackAllStatRestore: 1 } satisfies Record<DragonGateKind, number>;
type DragonGateKind = "mixedOverlayTypeAttackAllStatRestore";

describe("Lua real Dragon Gate restore coverage", () => {
  it("keeps Dragon Gate's mixed overlay type attack-all stat path owned", () => {
    const file = "test/lua-real-script-dragon-gate-overlay-type-attackall-stat.test.ts";
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
      'const dragonGateCode = "9567495"',
      "Dragon Gate",
      "restores detach of mixed overlay types into attack-all, self ATK gain, and opponent ATK loss",
      "Xyz.AddProcedure(c,nil,6,2,s.ovfilter,aux.Stringid(id,0),2,s.xyzop)",
      "Duel.RegisterFlagEffect(tp,id,RESET_PHASE|PHASE_END,EFFECT_FLAG_OATH,1)",
      "e0:SetCode(EFFECT_CANNOT_BE_XYZ_MATERIAL)",
      "e1:SetCode(EFFECT_ATTACK_ALL)",
      "c:RemoveOverlayCard(tp,1,c:GetOverlayCount(),REASON_EFFECT)>0",
      "Duel.GetOperatedGroup():GetClassCount(Card.GetMainCardType)",
      "c:UpdateAttack(atk,RESETS_STANDARD_DISABLE_PHASE_END)==atk",
      "tc:UpdateAttack(-atk,RESETS_STANDARD_PHASE_END,c)",
      "overlayUids).toEqual([])",
      "reasonEffectId: 2",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === dragonGate.uid), restored.session.state)).toBe(6000)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === opponentFirst.uid), restored.session.state)).toBe(0)",
      "code: effectAttackAll",
      "code: effectUpdateAttack",
      "value: 3000",
      "value: -3000",
      'eventName === "sentToGraveyard"',
      "eventReasonEffectId: 2",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Dragon Gate fixture kind explicit", () => {
    expect(dragonGateKindCounts).toEqual({ mixedOverlayTypeAttackAllStatRestore: 1 });
  });
});
