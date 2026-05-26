import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const fireburstKindCounts = { libromancerRitualBattleStat: 1 } satisfies Record<FireburstKind, number>;
type FireburstKind = "libromancerRitualBattleStat";

describe("Lua real Libromancer Fireburst restore coverage", () => {
  it("keeps Fireburst's ritual material battle modifiers and attack stat restore owned", () => {
    const file = "test/lua-real-script-libromancer-fireburst-ritual-battle-stat.test.ts";
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
      'const fireburstCode = "88106656"',
      "Libromancer Fireburst",
      "restores ritual material battle modifiers and attack-announce banish ATK gain",
      "e0:SetCode(EFFECT_MATERIAL_CHECK)",
      "c:GetMaterial():IsExists(Card.IsLocation,1,nil,LOCATION_MZONE)",
      "c:RegisterFlagEffect(id,RESET_EVENT|(RESETS_STANDARD&~RESET_TOFIELD),EFFECT_FLAG_CLIENT_HINT,1,0,aux.Stringid(id,0))",
      "return c:IsRitualSummoned() and c:GetFlagEffect(id)>0",
      "e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
      "e2:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)",
      "e2:SetValue(aux.ChangeBattleDamage(1,DOUBLE_DAMAGE))",
      "e3:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)",
      "e4:SetCode(EVENT_ATTACK_ANNOUNCE)",
      "return c:IsRitualMonster() and c:IsSetCard(SET_LIBROMANCER) and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)",
      "Duel.SelectMatchingCard(tp,s.atkcfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,c)",
      "Duel.Remove(g,POS_FACEUP,REASON_COST)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(200)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)",
      'summonType = "ritual"',
      "registerDuelFlagEffect",
      "reasonEffectId: 6",
      "currentAttack(findCard(restoredOpen.session, fireburst.uid), restoredOpen.session.state)).toBe(3000)",
      "battleDamage).toEqual({ 0: 0, 1: 4000 })",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Fireburst fixture kind explicit", () => {
    expect(fireburstKindCounts).toEqual({ libromancerRitualBattleStat: 1 });
  });
});
