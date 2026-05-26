import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const hazyFlameHyppogrifKindCounts = { releaseCostProtectStatRestore: 1 } satisfies Record<HazyFlameHyppogrifKind, number>;
type HazyFlameHyppogrifKind = "releaseCostProtectStatRestore";

describe("Lua real Hazy Flame Hyppogrif restore coverage", () => {
  it("keeps Hazy Flame Hyppogrif's FIRE release cost and protection/stat restore owned", () => {
    const file = "test/lua-real-script-hazy-flame-hyppogrif-release-protect-stat.test.ts";
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
      'const hyppogrifCode = "31303283"',
      "Hazy Flame Hyppogrif",
      "restores targeting protection and FIRE release cost into copy-inherit ATK gain",
      "e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)",
      "e1:SetValue(aux.tgoval)",
      "Duel.CheckReleaseGroupCost(tp,Card.IsAttribute,1,false,nil,e:GetHandler(),ATTRIBUTE_FIRE)",
      "Duel.SelectReleaseGroupCost(tp,Card.IsAttribute,1,1,false,nil,e:GetHandler(),ATTRIBUTE_FIRE)",
      "Duel.Release(g,REASON_COST)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(300)",
      "e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)",
      "reasonEffectId: 2",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === hyppogrif.uid), restored.session.state)).toBe(2400)",
      "code: effectCannotBeEffectTarget",
      "code: effectUpdateAttack",
      'eventName: "released"',
      'eventName: "sentToGraveyard"',
      "eventReasonEffectId: 2",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Hazy Flame Hyppogrif fixture kind explicit", () => {
    expect(hazyFlameHyppogrifKindCounts).toEqual({ releaseCostProtectStatRestore: 1 });
  });
});
