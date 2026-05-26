import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const shiningElfKindCounts = { summonDetachStatRestoreResponse: 1 } satisfies Record<ShiningElfKind, number>;
type ShiningElfKind = "summonDetachStatRestoreResponse";

describe("Lua real Shining Elf restore coverage", () => {
  it("keeps Shining Elf's summon-trigger detach stat restore flow owned", () => {
    const file = "test/lua-real-script-shining-elf-summon-detach-stat.test.ts";
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
      'const elfCode = "97170107"',
      "Shining Elf",
      "restores cloned summon-success triggers and detaches cost before lowering summoned opponent ATK",
      "Xyz.AddProcedure(c,nil,2,2)",
      "c:EnableReviveLimit()",
      "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
      "e1:SetCost(Cost.DetachFromSelf(1))",
      "Duel.SetTargetCard(eg)",
      "e2=e1:Clone()",
      "e2:SetCode(EVENT_SUMMON_SUCCESS)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(-500)",
      'triggerEvent: "specialSummoned"',
      'triggerEvent: "normalSummoned"',
      'action.type === "activateTrigger"',
      "applyLuaRestoreResponse",
      "passChain",
      "currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === opponentSummoned.uid), restoredResolved.session.state)).toBe(1300)",
      "overlayUids).toEqual([materialB.uid])",
      "reason: duelReason.cost",
      "reasonEffectId: 2",
      "reset: { flags: 33427456 }",
      "value: -500",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Shining Elf fixture kind explicit", () => {
    expect(shiningElfKindCounts).toEqual({ summonDetachStatRestoreResponse: 1 });
  });
});
