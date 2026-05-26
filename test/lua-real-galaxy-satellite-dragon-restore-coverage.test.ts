import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const galaxySatelliteKindCounts = { battleSelfBanishTopdeckRestore: 1 } satisfies Record<GalaxySatelliteKind, number>;
type GalaxySatelliteKind = "battleSelfBanishTopdeckRestore";

describe("Lua real Galaxy Satellite Dragon restore coverage", () => {
  it("keeps Galaxy Satellite Dragon's battle quick and End Phase topdeck paths owned", () => {
    const file = "test/lua-real-script-galaxy-satellite-dragon-battle-topdeck.test.ts";
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
      'const satelliteCode = "92362073"',
      "Galaxy Satellite Dragon",
      "restores grave battle quick self-banish stat and opponent End Phase topdeck confirmation",
      "Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_DRAGON),2,2)",
      "e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)",
      "e1:SetCost(Cost.SelfBanish)",
      "local ph=Duel.GetCurrentPhase()",
      "Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_MZONE,0,1,1,nil)",
      "e1:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)",
      "e1:SetValue(HALF_DAMAGE)",
      "aux.RegisterClientHint(c,nil,tp,1,0,aux.Stringid(id,2),PHASE_BATTLE)",
      "e3:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e3:SetValue(m.xyz_number*100)",
      "reasonEffectId: 2",
      "code: effectChangeBattleDamage",
      "code: effectSetAttackFinal",
      "value: 6200",
      'eventName === "banished"',
      'eventName === "becameTarget"',
      "e2:SetCode(EVENT_PHASE+PHASE_END)",
      "return Duel.IsTurnPlayer(1-tp)",
      "Duel.SelectMatchingCard(tp,aux.TRUE,tp,LOCATION_DECK,0,1,1,nil):GetFirst()",
      "Duel.ShuffleDeck(tp)",
      "Duel.MoveSequence(tc,0)",
      "Duel.ConfirmDecktop(tp,1)",
      'eventName: "phaseEnd"',
      'eventName: "confirmed"',
      "confirmed decktop 0:",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Galaxy Satellite Dragon fixture kind explicit", () => {
    expect(galaxySatelliteKindCounts).toEqual({ battleSelfBanishTopdeckRestore: 1 });
  });
});
