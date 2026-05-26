import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const doomKingArmageddonKindCounts = { destroyedMonsterStatAndDirectAttackOathRestore: 1 } satisfies Record<DoomKingArmageddonKind, number>;
type DoomKingArmageddonKind = "destroyedMonsterStatAndDirectAttackOathRestore";

describe("Lua real Doom King Armageddon restore coverage", () => {
  it("keeps Doom King Armageddon's destroyed-monster stat and oath restore flow owned", () => {
    const file = "test/lua-real-script-doom-king-armageddon-destroyed-stat.test.ts";
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
      'const armageddonCode = "47198668"',
      "D/D/D Doom King Armageddon",
      "restores destroyed-monster targeting into self ATK gain and direct-attack oath lock",
      "Pendulum.AddProcedure(c)",
      "e1:SetRange(LOCATION_PZONE)",
      "Duel.SelectTarget(tp,s.filter1,tp,LOCATION_MZONE,0,1,1,nil)",
      "e2:SetCode(EVENT_DESTROYED)",
      "e2:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)",
      "return c:IsReason(REASON_BATTLE|REASON_EFFECT) and c:IsMonster()",
      "Duel.SetTargetCard(g)",
      "e1:SetCode(EFFECT_CANNOT_DIRECT_ATTACK)",
      "e1:SetDescription(3207)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(tc:GetBaseAttack())",
      "e3:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)",
      "Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)",
      'eventName: "destroyed"',
      "eventReason: duelReason.effect | duelReason.destroy",
      'triggerBucket: "turnOptional"',
      'action.type === "activateTrigger"',
      "applyLuaRestoreResponse",
      "passChain",
      "currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === armageddon.uid), restoredResolved.session.state)).toBe(4800)",
      "code: effectCannotDirectAttack",
      "description: 3207",
      "property: 67634176",
      "reset: { flags: 1107169792 }",
      "code: effectUpdateAttack",
      "reset: { flags: 1107235328 }",
      "value: 1800",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Doom King Armageddon fixture kind explicit", () => {
    expect(doomKingArmageddonKindCounts).toEqual({ destroyedMonsterStatAndDirectAttackOathRestore: 1 });
  });
});
