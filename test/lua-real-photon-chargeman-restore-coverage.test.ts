import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const photonChargemanKindCounts = { attackLockFinalStatRestore: 1 } satisfies Record<PhotonChargemanKind, number>;
type PhotonChargemanKind = "attackLockFinalStatRestore";

describe("Lua real Photon Chargeman restore coverage", () => {
  it("keeps Photon Chargeman's attack lock and final ATK doubling owned", () => {
    const file = "test/lua-real-script-photon-chargeman-attack-lock-final-stat.test.ts";
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
      'const chargedmanCode = "2618045"',
      "Photon Chargeman",
      "restores attack-announced-count cost into cannot attack and base-ATK final doubling",
      "e1:SetCategory(CATEGORY_ATKCHANGE)",
      "e1:SetType(EFFECT_TYPE_IGNITION)",
      "e1:SetRange(LOCATION_MZONE)",
      "e1:SetCountLimit(1)",
      "return e:GetHandler():GetAttackAnnouncedCount()==0",
      "e1:SetDescription(3206)",
      "e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE+EFFECT_FLAG_CLIENT_HINT)",
      "e1:SetCode(EFFECT_CANNOT_ATTACK)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetValue(c:GetBaseAttack()*2)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE|RESET_PHASE|PHASE_STANDBY,2)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === chargedman.uid), restored.session.state)).toBe(2000)",
      "code: effectCannotAttack",
      "code: effectSetAttackFinal",
      "value: 2000",
      'eventName === "becameTarget"',
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Photon Chargeman fixture kind explicit", () => {
    expect(photonChargemanKindCounts).toEqual({ attackLockFinalStatRestore: 1 });
  });
});
