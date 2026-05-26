import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const ironChainCoilKindCounts = { targetAttackDefenseStatRestore: 1 } satisfies Record<IronChainCoilKind, number>;
type IronChainCoilKind = "targetAttackDefenseStatRestore";

describe("Lua real Iron Chain Coil restore coverage", () => {
  it("keeps Iron Chain Coil's target ATK/DEF restore owned", () => {
    const file = "test/lua-real-script-iron-chain-coil-target-attack-defense-stat.test.ts";
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
      'const coilCode = "53152590"',
      "Iron Chain Coil",
      "restores targeted Iron Chain ATK and DEF update effects",
      "s.listed_series={SET_IRON_CHAIN}",
      "return c:IsFaceup() and c:IsSetCard(SET_IRON_CHAIN)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(300)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD)",
      "e2:SetCode(EFFECT_UPDATE_DEFENSE)",
      "effectUpdateAttack",
      "effectUpdateDefense",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === coil.uid), restored.session.state)).toBe(1100)",
      "currentDefense(restored.session.state.cards.find((card) => card.uid === coil.uid), restored.session.state)).toBe(1900)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Iron Chain Coil fixture kind explicit", () => {
    expect(ironChainCoilKindCounts).toEqual({ targetAttackDefenseStatRestore: 1 });
  });
});
