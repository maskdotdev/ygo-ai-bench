import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const ayeIronKindCounts = { attackOathStatRestore: 1 } satisfies Record<AyeIronKind, number>;
type AyeIronKind = "attackOathStatRestore";

describe("Lua real Aye-Iron restore coverage", () => {
  it("keeps Aye-Iron's attack oath and stat gain owned", () => {
    const file = "test/lua-real-script-aye-iron-attack-oath-stat.test.ts";
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
      'const ayeIronCode = "42969214"',
      "Aye-Iron",
      "restores attack-announced-count cost into cannot-attack oath and copy-inherit ATK gain",
      "e1:SetCategory(CATEGORY_ATKCHANGE)",
      "e1:SetType(EFFECT_TYPE_IGNITION)",
      "e1:SetRange(LOCATION_MZONE)",
      "e1:SetCountLimit(1)",
      "return e:GetHandler():GetAttackAnnouncedCount()==0",
      "e1:SetDescription(3206)",
      "e1:SetCode(EFFECT_CANNOT_ATTACK)",
      "e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_OATH+EFFECT_FLAG_CLIENT_HINT)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)",
      "e1:SetValue(400)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === ayeIron.uid), restored.session.state)).toBe(2000)",
      "code: effectCannotAttack",
      "code: effectUpdateAttack",
      "value: 400",
      'eventName === "becameTarget"',
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Aye-Iron fixture kind explicit", () => {
    expect(ayeIronKindCounts).toEqual({ attackOathStatRestore: 1 });
  });
});
