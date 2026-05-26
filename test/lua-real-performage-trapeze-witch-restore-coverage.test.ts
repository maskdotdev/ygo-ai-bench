import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const trapezeWitchKindCounts = { performageProtectAttackAnnounceStat: 1 } satisfies Record<TrapezeWitchKind, number>;
type TrapezeWitchKind = "performageProtectAttackAnnounceStat";

describe("Lua real Performage Trapeze Witch restore coverage", () => {
  it("keeps Trapeze Witch's Performage protection and attack-announcement stat restore owned", () => {
    const file = "test/lua-real-script-performage-trapeze-witch-protect-attack-stat.test.ts";
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
      'const witchCode = "33206889"',
      "Performage Trapeze Witch",
      "restores Performage protection effects and attack-announcement ATK drop",
      "Fusion.AddProcMixN(c,true,true,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_PERFORMAGE),2)",
      "e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)",
      "e1:SetTarget(aux.TargetBoolFunction(Card.IsSetCard,SET_PERFORMAGE))",
      "e1:SetValue(aux.tgoval)",
      "e2:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)",
      "e2:SetValue(aux.indsval)",
      "e3:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)",
      "e3:SetCondition(s.cannotatkcon)",
      "e3:SetValue(aux.imval2)",
      "e4:SetCode(EVENT_ATTACK_ANNOUNCE)",
      "local bc0,bc1=Duel.GetBattleMonster(tp)",
      "bc0:IsSetCard(SET_PERFORMAGE)",
      "Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,bc1,1,tp,-600)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(-600)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD)",
      "targetUid === witch.uid",
      "currentAttack(findCard(restoredAttack.session, attacker.uid), restoredAttack.session.state)).toBe(1800)",
      "effectUpdateAttack",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Trapeze Witch fixture kind explicit", () => {
    expect(trapezeWitchKindCounts).toEqual({ performageProtectAttackAnnounceStat: 1 });
  });
});
