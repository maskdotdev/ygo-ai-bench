import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const funkyComedianKindCounts = { pzoneReleaseCostStatTransferRestore: 1 } satisfies Record<FunkyComedianKind, number>;
type FunkyComedianKind = "pzoneReleaseCostStatTransferRestore";

describe("Lua real Abyss Actor Funky Comedian restore coverage", () => {
  it("keeps Funky Comedian's PZone release-cost stat transfer owned", () => {
    const file = "test/lua-real-script-abyss-actor-funky-comedian-release-stat.test.ts";
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
      'const funkyCode = "99634927"',
      "Abyss Actor - Funky Comedian",
      "restores PZone release-cost ATK transfer plus summon and monster-zone stat metadata",
      "Pendulum.AddProcedure(c)",
      "Duel.CheckReleaseGroupCost(tp,s.atkfilter1,1,false,nil,nil,tp)",
      "Duel.SelectReleaseGroupCost(tp,s.atkfilter1,1,1,false,nil,nil,tp)",
      "e:SetLabel(g:GetFirst():GetBaseAttack())",
      "Duel.Release(g,REASON_COST)",
      "Duel.SelectTarget(tp,s.atkfilter2,tp,LOCATION_MZONE,0,1,1,nil)",
      "e2:SetCode(EVENT_SUMMON_SUCCESS)",
      "e3:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "Duel.GetMatchingGroupCount(s.atkfilter2,tp,LOCATION_MZONE,0,nil)*300",
      "e1:SetCode(EFFECT_CANNOT_ATTACK)",
      "e1:SetDescription(3206)",
      'range: ["spellTrapZone"]',
      'triggerEvent: "normalSummoned"',
      'triggerEvent: "specialSummoned"',
      'action.type === "activateEffect"',
      "applyLuaRestoreResponse",
      "resolveRestoredChain",
      "currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === targetActor.uid), restoredResolved.session.state)).toBe(3200)",
      "reason: duelReason.cost | duelReason.release",
      "reasonEffectId: 3",
      "code: effectUpdateAttack",
      "reset: { flags: 1107169792 }",
      "value: 1800",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Funky Comedian fixture kind explicit", () => {
    expect(funkyComedianKindCounts).toEqual({ pzoneReleaseCostStatTransferRestore: 1 });
  });
});
