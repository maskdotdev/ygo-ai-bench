import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const cabreraKindCounts = { releaseCheckTargetZeroStatRestore: 1 } satisfies Record<CabreraKind, number>;
type CabreraKind = "releaseCheckTargetZeroStatRestore";

describe("Lua real Chronomaly Cabrera Trebuchet restore coverage", () => {
  it("keeps Cabrera's release-cost target zero-stat restore owned", () => {
    const file = "test/lua-real-script-chronomaly-cabrera-release-zero-stat.test.ts";
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
      'const cabreraCode = "20154092"',
      "Chronomaly Cabrera Trebuchet",
      "restores ReleaseCheckTarget Chronomaly cost into opponent face-up ATK set to 0",
      "s.listed_series={SET_CHRONOMALY}",
      "Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,aux.ReleaseCheckTarget,e:GetHandler(),dg)",
      "Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,aux.ReleaseCheckTarget,e:GetHandler(),dg)",
      "Duel.Release(g,REASON_COST)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetValue(0)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "reasonEffectId: 1",
      "eventReasonEffectId: 1",
      'eventName: "released"',
      'eventName: "sentToGraveyard"',
      "currentAttack(restored.session.state.cards.find((card) => card.uid === opponentTarget.uid), restored.session.state)).toBe(0)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Cabrera fixture kind explicit", () => {
    expect(cabreraKindCounts).toEqual({ releaseCheckTargetZeroStatRestore: 1 });
  });
});
