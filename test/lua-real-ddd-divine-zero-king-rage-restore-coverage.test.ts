import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const divineZeroKingRageKindCounts = { releaseCostOptionDirectAttackRestore: 1 } satisfies Record<DivineZeroKingRageKind, number>;
type DivineZeroKingRageKind = "releaseCostOptionDirectAttackRestore";

describe("Lua real D/D/D Divine Zero King Rage restore coverage", () => {
  it("keeps Divine Zero King Rage's release-cost option direct attack owned", () => {
    const file = "test/lua-real-script-ddd-divine-zero-king-rage-option-direct-attack.test.ts";
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
      'const rageCode = "40227329"',
      "Go! - D/D/D Divine Zero King Rage",
      "restores release-cost SelectOption direct attack into attack-announcement final ATK and damage",
      "Pendulum.AddProcedure(c)",
      "e1:SetCode(EFFECT_CHANGE_DAMAGE)",
      "e2:SetCode(EFFECT_NO_EFFECT_DAMAGE)",
      "e3:SetCode(EFFECT_SUMMON_PROC)",
      "Duel.CheckReleaseGroupCost(tp,nil,1,false,nil,e:GetHandler())",
      "Duel.SelectReleaseGroupCost(tp,nil,1,1,false,nil,e:GetHandler())",
      "Duel.SelectOption(tp,table.unpack(dtab))+1",
      "e1:SetCode(EFFECT_DIRECT_ATTACK)",
      "e5:SetCode(EVENT_ATTACK_ANNOUNCE)",
      "return Duel.GetLP(1-tp)<=4000",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetValue(lp)",
      "e6:SetCode(EFFECT_AVOID_BATTLE_DAMAGE)",
      "e7:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
      'triggerEvent: "attackDeclared"',
      'action.type === "activateEffect"',
      'action.type === "activateTrigger"',
      "applyLuaRestoreResponse",
      "resolveRestoredChain",
      "passRestoredBattle",
      'api: "SelectOption"',
      "descriptions: [643637266, 643637267, 643637268]",
      "reason: duelReason.cost | duelReason.release",
      "reasonEffectId: 6",
      "code: effectDirectAttack",
      "code: effectSetAttackFinal",
      "currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === rage.uid), restoredBattle.session.state)).toBe(3500)",
      "eventName === \"beforeBattleDamage\"",
      "eventCode: 1136",
      "eventValue: 3500",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Divine Zero King Rage fixture kind explicit", () => {
    expect(divineZeroKingRageKindCounts).toEqual({ releaseCostOptionDirectAttackRestore: 1 });
  });
});
