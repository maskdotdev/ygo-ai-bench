import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const darkAngelKindCounts = { battleRetargetCostReleaseStatRestore: 1 } satisfies Record<DarkAngelKind, number>;
type DarkAngelKind = "battleRetargetCostReleaseStatRestore";

describe("Lua real Dark Angel restore coverage", () => {
  it("keeps Dark Angel's battle retarget cost and stat restore flow owned", () => {
    const file = "test/lua-real-script-dark-angel-battle-retarget-stat.test.ts";
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
      'const darkAngelCode = "28593329"',
      "Dark Angel",
      "restores its hand battle-target trigger, cost release/send, attack retarget, and ATK gain",
      "e1:SetCode(EVENT_BE_BATTLE_TARGET)",
      "e1:SetRange(LOCATION_HAND)",
      "e:GetHandler():IsAbleToGraveAsCost()",
      "at:IsRace(RACE_FAIRY) and at:IsReleasable()",
      "e:SetLabel(at:GetBaseAttack())",
      "Duel.Release(at,REASON_COST)",
      "Duel.SendtoGrave(e:GetHandler(),REASON_COST)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,at)",
      "Duel.ChangeAttackTarget(tc)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(e:GetLabel())",
      'eventName: "battleTargeted"',
      'triggerEvent: undefined',
      'action.type === "activateTrigger"',
      "applyLuaRestoreResponse",
      "passChain",
      "pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: retarget.uid })",
      "currentAttack(resolved.session.state.cards.find((card) => card.uid === retarget.uid), resolved.session.state)).toBe(2800)",
      "reason: duelReason.cost | duelReason.release",
      "reason: duelReason.cost",
      "reasonEffectId: 1",
      "reset: { flags: 1107169280 }",
      "value: 1600",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Dark Angel fixture kind explicit", () => {
    expect(darkAngelKindCounts).toEqual({ battleRetargetCostReleaseStatRestore: 1 });
  });
});
