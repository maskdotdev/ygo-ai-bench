import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const jurracTyrannusKindCounts = { releaseCostIgnitionBattleDestroyingStatRestore: 1 } satisfies Record<JurracTyrannusKind, number>;
type JurracTyrannusKind = "releaseCostIgnitionBattleDestroyingStatRestore";

describe("Lua real Jurrac Tyrannus restore coverage", () => {
  it("keeps Jurrac Tyrannus's release-cost stat and battle-destroying metadata owned", () => {
    const file = "test/lua-real-script-jurrac-tyrannus-release-battle-stat.test.ts";
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
      'const tyrannusCode = "62701967"',
      "Jurrac Tyrannus",
      "restores release-cost ignition ATK gain and battle-destroying trigger metadata",
      "Duel.CheckReleaseGroupCost(tp,Card.IsRace,1,false,nil,e:GetHandler(),RACE_DINOSAUR)",
      "Duel.SelectReleaseGroupCost(tp,Card.IsRace,1,1,false,nil,e:GetHandler(),RACE_DINOSAUR)",
      "Duel.Release(sg,REASON_COST)",
      "e2:SetCode(EVENT_BATTLE_DESTROYING)",
      "e2:SetLabel(300)",
      "local bc=c:GetBattleTarget()",
      "bc:IsLocation(LOCATION_GRAVE) and bc:IsReason(REASON_BATTLE) and bc:IsMonster()",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(e:GetLabel())",
      'triggerEvent: "battleDestroyed"',
      'action.type === "activateEffect"',
      "applyLuaRestoreResponse",
      "resolveRestoredChain",
      "currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === tyrannus.uid), restoredResolved.session.state)).toBe(3000)",
      "reason: duelReason.cost | duelReason.release",
      "reasonEffectId: 1",
      "code: effectUpdateAttack",
      "reset: { flags: 33492992 }",
      "value: 500",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Jurrac Tyrannus fixture kind explicit", () => {
    expect(jurracTyrannusKindCounts).toEqual({ releaseCostIgnitionBattleDestroyingStatRestore: 1 });
  });
});
